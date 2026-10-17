import { safeConfigurationMapKey } from './configurationMap.js'

export type ConfigurationSchemaObject = Record<string, unknown>

export type ConfigurationSchemaVariant = {
  index: number
  schema: ConfigurationSchemaObject
  label: string
}

export type ConfigurationRequiredFieldRenderability = (schema: ConfigurationSchemaObject, current: unknown, path: string[]) => boolean

const maxSchemaDepth = 64
const protectedNameMarkers = ['secret', 'token', 'password', 'privatekey', 'authorization']
const supportedControls = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'select', 'multiselect', 'duration', 'size', 'file', 'dir', 'directory', 'secret-ref', 'uri', 'url', 'email', 'date', 'date-time'])

export function resolveConfigurationSchema(root: unknown, value: unknown, depth = 0, seen = new Set<string>()): ConfigurationSchemaObject | null {
  const schema = asObject(value)
  if (!schema || depth > maxSchemaDepth) return null
  if (!Object.hasOwn(schema, '$ref')) return schema
  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return null
  const reference = schema.$ref
  if (seen.has(reference)) return null
  const target = pointerValue(root, reference)
  if (!asObject(target)) return null
  const nextSeen = new Set(seen)
  nextSeen.add(reference)
  const resolved = resolveConfigurationSchema(root, target, depth + 1, nextSeen)
  if (!resolved) return null
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'))
  return mergeSchemas(resolved, siblings)
}

export function configurationSchemaVariants(root: unknown, value: unknown): ConfigurationSchemaVariant[] | null {
  const schema = resolveConfigurationSchema(root, value)
  if (!schema || schema.anyOf !== undefined || !Array.isArray(schema.oneOf) || schema.oneOf.length < 2 || schema.oneOf.length > 64) return null
  const variants: ConfigurationSchemaVariant[] = []
  for (let index = 0; index < schema.oneOf.length; index += 1) {
    const branch = resolveConfigurationSchema(root, schema.oneOf[index])
    if (!branch) return null
    variants.push({ index, schema: branch, label: variantLabel(branch, index) })
  }
  return variants
}

export function selectedConfigurationVariant(root: unknown, variants: ConfigurationSchemaVariant[], value: unknown): ConfigurationSchemaVariant | null {
  const matches = variants.filter((variant) => configurationSchemaMatchesValue(root, variant.schema, value))
  if (matches.length === 1) return matches[0] ?? null
  const current = asObject(value)
  if (!current) return null
  const candidates = variants.filter((variant) => {
    const properties = asObject(effectiveConfigurationSchema(root, variant.schema, current)?.properties)
    if (!properties) return false
    const discriminators = Object.entries(properties).filter(([, raw]) => {
      const child = asObject(raw)
      return Boolean(child && Object.hasOwn(child, 'const'))
    })
    return discriminators.length > 0 && discriminators.every(([name, raw]) => {
      const child = asObject(raw)
      return Boolean(child && Object.hasOwn(current, name) && jsonEqual(current[name], child.const))
    })
  })
  return candidates.length === 1 ? candidates[0] ?? null : null
}

export function effectiveConfigurationSchema(root: unknown, value: unknown, current: unknown, depth = 0): ConfigurationSchemaObject | null {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > maxSchemaDepth) return null
  const result = { ...schema }
  delete result.allOf
  delete result.if
  delete result.then
  delete result.else
  for (const rawBranch of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const branch = resolveConfigurationSchema(root, rawBranch, depth + 1)
    if (!branch) return null
    if (asObject(branch.if)) {
      const condition = configurationSchemaMatchesValue(root, branch.if, current)
      const conditionless = Object.fromEntries(Object.entries(branch).filter(([key]) => !['if', 'then', 'else'].includes(key)))
      mergeSchemas(result, conditionless, true)
      if (condition && branch.then !== undefined) {
        const active = effectiveConfigurationSchema(root, branch.then, current, depth + 1)
        if (!active) return null
        mergeSchemas(result, active, true)
      } else if (branch.else !== undefined) {
        const active = effectiveConfigurationSchema(root, branch.else, current, depth + 1)
        if (!active) return null
        mergeSchemas(result, active, true)
      }
      continue
    }
    mergeSchemas(result, branch, true)
  }
  if (asObject(schema.if)) {
    const condition = configurationSchemaMatchesValue(root, schema.if, current)
    if (condition && schema.then !== undefined) {
      const active = effectiveConfigurationSchema(root, schema.then, current, depth + 1)
      if (!active) return null
      mergeSchemas(result, active, true)
    } else if (schema.else !== undefined) {
      const active = effectiveConfigurationSchema(root, schema.else, current, depth + 1)
      if (!active) return null
      mergeSchemas(result, active, true)
    }
  }
  return result
}

export function configurationSchemaMatchesValue(root: unknown, value: unknown, current: unknown, depth = 0): boolean {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > maxSchemaDepth) return false
  if (Array.isArray(schema.allOf) && !schema.allOf.every((branch) => configurationSchemaMatchesValue(root, branch, current, depth + 1))) return false
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((branch) => configurationSchemaMatchesValue(root, branch, current, depth + 1)).length !== 1) return false
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => configurationSchemaMatchesValue(root, branch, current, depth + 1))) return false
  if (schema.type === 'object' && !asObject(current)) return false
  if (schema.type === 'array' && !Array.isArray(current)) return false
  if (schema.type === 'string' && typeof current !== 'string') return false
  if (schema.type === 'boolean' && typeof current !== 'boolean') return false
  if ((schema.type === 'number' || schema.type === 'integer') && (typeof current !== 'number' || (schema.type === 'integer' && !Number.isInteger(current)))) return false
  if (Object.hasOwn(schema, 'const') && !jsonEqual(current, schema.const)) return false
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(entry, current))) return false
  const object = asObject(current)
  if (object && Array.isArray(schema.required) && schema.required.some((name) => typeof name !== 'string' || !Object.hasOwn(object, name))) return false
  const properties = asObject(schema.properties)
  if (object && properties) {
    for (const [name, child] of Object.entries(properties)) {
      if (Object.hasOwn(object, name) && !configurationSchemaMatchesValue(root, child, object[name], depth + 1)) return false
    }
    const additional = schema.additionalProperties
    if (additional === false && Object.keys(object).some((name) => !Object.hasOwn(properties, name))) return false
    if (asObject(additional) && Object.entries(object).some(([name, value]) => !Object.hasOwn(properties, name) && !configurationSchemaMatchesValue(root, additional, value, depth + 1))) return false
  }
  if (Array.isArray(current)) {
    if (typeof schema.minItems === 'number' && current.length < schema.minItems) return false
    if (typeof schema.maxItems === 'number' && current.length > schema.maxItems) return false
    if (schema.items !== undefined && current.some((item) => !configurationSchemaMatchesValue(root, schema.items, item, depth + 1))) return false
  }
  return true
}

export function createConfigurationSchemaValue(root: unknown, value: unknown, depth = 0): unknown {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > maxSchemaDepth) return null
  if (Object.hasOwn(schema, 'const')) return cloneJSON(schema.const)
  if (Object.hasOwn(schema, 'default')) return cloneJSON(schema.default)
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return cloneJSON(schema.enum[0])
  const variants = configurationSchemaVariants(root, schema)
  if (variants) {
    const safeVariant = variants.find((variant) => !configurationSchemaHasProtectedFields(root, variant.schema))
    return createConfigurationSchemaValue(root, (safeVariant ?? variants[0]).schema, depth + 1)
  }
  const effective = effectiveConfigurationSchema(root, schema, {}, depth + 1)
  if (!effective) return null
  if (effective.type === 'object') {
    const properties = asObject(effective.properties) ?? {}
    const required = new Set(Array.isArray(effective.required) ? effective.required.filter((name): name is string => typeof name === 'string') : [])
    const result: ConfigurationSchemaObject = {}
    for (const [name, child] of Object.entries(properties)) {
      const resolved = resolveConfigurationSchema(root, child, depth + 1)
      const childVariants = configurationSchemaVariants(root, child)
      const safeVariant = childVariants?.find((variant) => !configurationSchemaHasProtectedFields(root, variant.schema, name, depth + 1))
      const templateSchema = safeVariant?.schema ?? child
      if (required.has(name) || (resolved && (Object.hasOwn(resolved, 'default') || Object.hasOwn(resolved, 'const')))) {
        if (!configurationSchemaHasProtectedFields(root, templateSchema, name, depth + 1)) {
          result[name] = createConfigurationSchemaValue(root, templateSchema, depth + 1)
        }
      }
    }
    return result
  }
  if (effective.type === 'array') return []
  if (effective.type === 'boolean') return false
  if (effective.type === 'integer' || effective.type === 'number') return typeof effective.minimum === 'number' ? effective.minimum : 0
  if (effective.type === 'string') return ''
  if (effective.type === 'null') return null
  return null
}

/**
 * Protected arrays can insert a schema-derived item only when required values
 * are initialized without inventing protected data and every required editable
 * field has a usable renderer. This prevents rows that cannot be completed in
 * the Studio form while allowing preserved values and optional unsupported data.
 */
export function configurationSchemaCanCreateProtectedArrayItem(root: unknown, value: unknown, renderRequiredField: ConfigurationRequiredFieldRenderability = (schema, current) => configurationSchemaRenderable(root, schema, current)): boolean {
  const initial = createConfigurationSchemaValue(root, value)
  return !hasUninitializedRequiredConfigurationValue(root, value, initial) &&
    requiredConfigurationFieldsRenderable(root, value, initial, renderRequiredField)
}

function requiredConfigurationFieldsRenderable(root: unknown, schemaValue: unknown, current: unknown, renderRequiredField: ConfigurationRequiredFieldRenderability, depth = 0, path: string[] = []): boolean {
  if (depth > maxSchemaDepth) return false
  let selectedSchema = schemaValue
  const variants = configurationSchemaVariants(root, schemaValue)
  if (variants) {
    const selected = selectedConfigurationVariant(root, variants, current)
    if (!selected) return false
    selectedSchema = selected.schema
  }
  const schema = effectiveConfigurationSchema(root, selectedSchema, current, depth + 1)
  if (!schema) return false

  const object = asObject(current)
  if (object && schema.type === 'object') {
    const properties = asObject(schema.properties) ?? {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const name of required) {
      if (typeof name !== 'string' || !Object.hasOwn(properties, name) || !Object.hasOwn(object, name)) return false
      const child = properties[name]
      const childSchema = resolveConfigurationSchema(root, child, depth + 1)
      if (!childSchema) return false
      // A present protected field is preserved from the canonical value.
      if (isProtected(childSchema, name)) continue
      if (!requiredConfigurationFieldsRenderable(root, child, object[name], renderRequiredField, depth + 1, [...path, name])) return false
    }
    return true
  }

  if (Array.isArray(current) && schema.type === 'array') {
    const itemSchema = configurationSchemaArrayItem(root, selectedSchema)
    if (!itemSchema) return current.length === 0 && Number(schema.minItems ?? 0) === 0
    for (let index = 0; index < current.length; index += 1) {
      if (!requiredConfigurationFieldsRenderable(root, itemSchema, current[index], renderRequiredField, depth + 1, [...path, String(index)])) return false
    }
    const minimum = typeof schema.minItems === 'number' ? Math.max(0, Math.ceil(schema.minItems)) : 0
    if (current.length < minimum) {
      const itemTemplate = createConfigurationSchemaValue(root, itemSchema, depth + 1)
      return requiredConfigurationFieldsRenderable(root, itemSchema, itemTemplate, renderRequiredField, depth + 1, [...path, String(current.length)])
    }
    return true
  }

  if (isProtected(schema, '')) return true
  const resolved = resolveConfigurationSchema(root, selectedSchema, depth + 1)
  return Boolean(resolved && renderRequiredField(resolved, current, path))
}

function hasUninitializedRequiredConfigurationValue(root: unknown, schemaValue: unknown, current: unknown, depth = 0): boolean {
  if (depth > maxSchemaDepth) return true
  let selectedSchema = schemaValue
  const variants = configurationSchemaVariants(root, schemaValue)
  if (variants) {
    const selected = selectedConfigurationVariant(root, variants, current)
    if (!selected) return true
    selectedSchema = selected.schema
  }
  const schema = effectiveConfigurationSchema(root, selectedSchema, current, depth + 1)
  if (!schema) return true

  const object = asObject(current)
  if (object) {
    const properties = asObject(schema.properties) ?? {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const name of required) {
      if (typeof name !== 'string' || !Object.hasOwn(properties, name) || !Object.hasOwn(object, name)) return true
    }
    for (const [name, child] of Object.entries(properties)) {
      if (Object.hasOwn(object, name) && hasUninitializedRequiredConfigurationValue(root, child, object[name], depth + 1)) return true
    }
  }

  if (Array.isArray(current)) {
    const item = configurationSchemaArrayItem(root, selectedSchema)
    if (!item && current.length > 0) return true
    if (item && current.some((entry) => hasUninitializedRequiredConfigurationValue(root, item, entry, depth + 1))) return true
  }
  return false
}

export type ConfigurationVariantValue = { ok: true; value: unknown } | { ok: false }

export function configurationVariantValue(root: unknown, schemaValue: unknown, current: unknown, variantIndex: number): ConfigurationVariantValue {
  const variants = configurationSchemaVariants(root, schemaValue)
  const selected = variants?.find((variant) => variant.index === variantIndex)
  if (!selected || configurationSchemaProtected(root, selected.schema)) return { ok: false }
  const next = createConfigurationSchemaValue(root, selected.schema)
  const currentObject = asObject(current)
  const nextObject = asObject(next)
  const effective = effectiveConfigurationSchema(root, selected.schema, next)
  const properties = asObject(effective?.properties)
  if (!nextObject || !properties) return { ok: true, value: next }
  for (const [name, child] of Object.entries(properties)) {
    if (!currentObject || !Object.hasOwn(currentObject, name) || !configurationSchemaMatchesValue(root, child, currentObject[name])) continue
    nextObject[name] = cloneJSON(currentObject[name])
  }
  return { ok: true, value: nextObject }
}

export function configurationSchemaProtected(root: unknown, value: unknown, propertyName = '', depth = 0, seen = new Set<unknown>()): boolean {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > maxSchemaDepth || seen.has(schema)) return true
  if (isProtected(schema, propertyName)) return true
  // These host-rendered bounded JSON controls are explicitly editable. Their
  // open JSON shape is not a reason to classify the containing row as protected.
  if (schema['x-studio-json-document'] === true || schema['x-studio-json-value'] === true || Object.keys(schema).length === 0) return false
  const nextSeen = new Set(seen)
  nextSeen.add(schema)
  const properties = asObject(schema.properties)
  if (schema.properties !== undefined && !properties) return true
  if (properties && Object.entries(properties).some(([name, child]) => configurationSchemaProtected(root, child, name, depth + 1, nextSeen))) return true
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    const additional = asObject(schema.additionalProperties)
    if (!additional || configurationSchemaProtected(root, additional, '', depth + 1, nextSeen)) return true
  }
  if (schema.type === 'array' && (schema.items === undefined || configurationSchemaProtected(root, schema.items, propertyName, depth + 1, nextSeen))) return true
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (schema[key] === undefined) continue
    if (!Array.isArray(schema[key]) || schema[key].length === 0 || schema[key].some((branch) => configurationSchemaProtected(root, branch, propertyName, depth + 1, nextSeen))) return true
  }
  for (const key of ['if', 'then', 'else']) {
    if (schema[key] !== undefined && configurationSchemaProtected(root, schema[key], propertyName, depth + 1, nextSeen)) return true
  }
  return false
}

function configurationSchemaHasProtectedFields(root: unknown, value: unknown, propertyName = '', depth = 0): boolean {
  if (depth > maxSchemaDepth) return true
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || isProtected(schema, propertyName)) return true
  if (schema['x-studio-json-document'] === true || schema['x-studio-json-value'] === true || Object.keys(schema).length === 0) return false
  const properties = asObject(schema.properties)
  if (schema.properties !== undefined && !properties) return true
  if (properties && Object.entries(properties).some(([name, child]) => configurationSchemaHasProtectedFields(root, child, name, depth + 1))) return true
  const items = schema.items
  if (items !== undefined && configurationSchemaHasProtectedFields(root, items, propertyName, depth + 1)) return true
  const additional = asObject(schema.additionalProperties)
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false &&
      (!additional || configurationSchemaHasProtectedFields(root, additional, '', depth + 1))) return true
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const branches = schema[key]
    if (branches !== undefined && (!Array.isArray(branches) || branches.some((branch) => configurationSchemaHasProtectedFields(root, branch, propertyName, depth + 1)))) return true
  }
  for (const key of ['if', 'then', 'else']) {
    if (schema[key] !== undefined && configurationSchemaHasProtectedFields(root, schema[key], propertyName, depth + 1)) return true
  }
  return false
}

export function configurationSchemaChild(root: unknown, value: unknown, name: string, depth = 0): ConfigurationSchemaObject | null {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > maxSchemaDepth) return null
  const candidates: ConfigurationSchemaObject[] = []
  const properties = asObject(schema.properties)
  const direct = asObject(properties?.[name])
  if (properties && Object.hasOwn(properties, name)) {
    if (!direct) return null
    candidates.push(direct)
  } else {
    const additional = asObject(schema.additionalProperties)
    if (additional) candidates.push(additional)
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const branches = schema[key]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      const child = configurationSchemaChild(root, branch, name, depth + 1)
      if (child) candidates.push(child)
    }
  }
  for (const key of ['then', 'else']) {
    if (schema[key] === undefined) continue
    const child = configurationSchemaChild(root, schema[key], name, depth + 1)
    if (child) candidates.push(child)
  }
  const unique = candidates.filter((candidate, index) => candidates.findIndex((entry) => jsonEqual(entry, candidate)) === index)
  if (unique.length === 0) return null
  return unique.length === 1 ? unique[0] ?? null : { anyOf: unique }
}

export function configurationSchemaArrayItem(root: unknown, value: unknown, depth = 0): ConfigurationSchemaObject | null {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > maxSchemaDepth) return null
  const candidates: ConfigurationSchemaObject[] = []
  const direct = schema.items === undefined ? null : resolveConfigurationSchema(root, schema.items, depth + 1)
  if (direct) candidates.push(direct)
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const branches = schema[key]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      const item = configurationSchemaArrayItem(root, branch, depth + 1)
      if (item) candidates.push(item)
    }
  }
  const unique = candidates.filter((candidate, index) => candidates.findIndex((entry) => jsonEqual(entry, candidate)) === index)
  if (unique.length === 0) return null
  return unique.length === 1 ? unique[0] ?? null : { anyOf: unique }
}

export function configurationSchemaRenderable(root: unknown, value: unknown, current: unknown = {}, depth = 0): boolean {
  if (depth > maxSchemaDepth) return false
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema) return false
  const variants = configurationSchemaVariants(root, schema)
  if (variants) {
    const selected = selectedConfigurationVariant(root, variants, current)
    const candidates = selected ? [selected] : variants
    return candidates.every((variant) => configurationSchemaRenderable(root, variant.schema, selected ? current : createConfigurationSchemaValue(root, variant.schema), depth + 1))
  }
  const effective = effectiveConfigurationSchema(root, schema, current, depth + 1)
  if (!effective || effective.anyOf !== undefined || 'oneOf' in effective) return false
  if (isProtected(effective, '')) return true
  if (effective['x-studio-json-value'] === true) return true
  // An empty JSON Schema imposes no constraints and therefore accepts any
  // JSON value. Keep open object schemas fail-closed; only the exact empty
  // schema receives the bounded JSON-value editor.
  if (Object.keys(effective).length === 0) return true
  if (effective['x-studio-json-document'] === true) {
    return effective.type === 'object' && effective.additionalProperties === true &&
      effective.patternProperties === undefined && effective.propertyNames === undefined
  }
  const additionalSchema = asObject(effective.additionalProperties)
  if (additionalSchema && configurationSchemaProtected(root, additionalSchema)) return false
  if (effective.patternProperties !== undefined || effective.dependentSchemas !== undefined || effective.propertyNames !== undefined) return false
  const additional = effective.additionalProperties
  if (additional !== undefined && additional !== false && !asObject(additional)) return false
  if (Object.hasOwn(effective, 'const')) return true
  const custom = effective['x-studio-control']
  const control = typeof custom === 'string' ? custom : typeof effective.format === 'string' ? effective.format : typeof effective.type === 'string' ? effective.type : Array.isArray(effective.enum) ? 'select' : ''
  if (!supportedControls.has(control)) return false
  if (control === 'object') {
    const properties = asObject(effective.properties)
    const object = asObject(current) ?? {}
    if (properties && !Object.entries(properties).every(([name, child]) => isProtected(asObject(child) ?? {}, name) || configurationSchemaRenderable(root, child, object[name], depth + 1))) return false
    if (!additionalSchema) return Boolean(properties) || additional === false
    const declared = new Set(Object.keys(properties ?? {}))
    return Object.entries(object).filter(([name]) => !declared.has(name) && safeConfigurationMapKey(name)).every(([name, entry]) =>
      isProtected(additionalSchema, name) || configurationSchemaRenderable(root, additionalSchema, entry, depth + 1))
  }
  if (control === 'array') {
    const item = asObject(effective.items)
    if (!item) return false
    const values = Array.isArray(current) ? current : []
    return values.length === 0 || values.every((entry) => configurationSchemaRenderable(root, item, entry, depth + 1))
  }
  return true
}

function mergeSchemas(target: ConfigurationSchemaObject, source: ConfigurationSchemaObject, mutate = false): ConfigurationSchemaObject {
  const result = mutate ? target : { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (key === 'properties') {
      const existing = asObject(result.properties) ?? {}
      const incoming = asObject(value)
      if (!incoming) continue
      const merged: ConfigurationSchemaObject = { ...existing }
      for (const [name, child] of Object.entries(incoming)) {
        const previous = asObject(merged[name])
        const next = asObject(child)
        if (previous && next) merged[name] = { allOf: [previous, next] }
        else merged[name] = child
      }
      result.properties = merged
    } else if (key === 'required' && Array.isArray(value)) {
      result.required = [...new Set([...(Array.isArray(result.required) ? result.required.filter((name): name is string => typeof name === 'string') : []), ...value.filter((name): name is string => typeof name === 'string')])]
    } else if (['allOf', 'if', 'then', 'else'].includes(key)) {
      continue
    } else if (key === 'additionalProperties' && (result[key] === false || value === false)) {
      result[key] = false
    } else if (['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties'].includes(key) && typeof value === 'number') {
      result[key] = typeof result[key] === 'number' ? Math.max(result[key], value) : value
    } else if (['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties'].includes(key) && typeof value === 'number') {
      result[key] = typeof result[key] === 'number' ? Math.min(result[key], value) : value
    } else if (!(key in result)) {
      result[key] = value
    }
  }
  return result
}

function variantLabel(schema: ConfigurationSchemaObject, index: number): string {
  if (typeof schema.title === 'string' && schema.title.trim()) return schema.title
  const properties = asObject(schema.properties) ?? {}
  for (const [name, childValue] of Object.entries(properties)) {
    const child = asObject(childValue)
    if (child && Object.hasOwn(child, 'const')) return `${name}: ${String(child.const)}`
  }
  return `Variant ${String(index + 1)}`
}

function pointerValue(root: unknown, pointer: string): unknown {
  const parts = pointer.slice(2).split('/')
  let current: unknown = root
  for (const part of parts) {
    if (/~(?![01])/u.test(part)) return undefined
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    const object = asObject(current)
    if (!object || ['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(object, key)) return undefined
    current = object[key]
  }
  return current
}

function isProtected(schema: ConfigurationSchemaObject, name: string): boolean {
  const normalized = name.toLowerCase()
  return schema.readOnly === true || schema.writeOnly === true || schema['x-sensitive'] === true || schema['x-secret'] === true ||
    schema['x-redacted'] === true || schema['x-liapoldus-sensitive'] === true || schema.format === 'password' ||
    protectedNameMarkers.some((marker) => normalized.includes(marker))
}

function asObject(value: unknown): ConfigurationSchemaObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as ConfigurationSchemaObject
}

function cloneJSON(value: unknown): unknown { return JSON.parse(JSON.stringify(value)) as unknown }

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => jsonEqual(entry, right[index]))
  const leftObject = asObject(left)
  const rightObject = asObject(right)
  if (!leftObject || !rightObject) return false
  const leftKeys = Object.keys(leftObject).sort()
  const rightKeys = Object.keys(rightObject).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(leftObject[key], rightObject[key]))
}
