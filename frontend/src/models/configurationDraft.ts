import { applyConfigurationArrayOperations, configurationArrayOperations, configurationArrayOperationsKey, configurationJSONDocumentKey, type ConfigurationArrayOperation } from './configurationArray.js'
import { configurationMapOperations, configurationMapOperationsKey, safeConfigurationMapKey, type ConfigurationMapOperation } from './configurationMap.js'
import { configurationSchemaArrayItem, configurationSchemaChild, configurationSchemaMatchesValue, configurationSchemaProtected, configurationSchemaVariants, effectiveConfigurationSchema, resolveConfigurationSchema } from './configurationSchema.js'

export type ConfigurationObject = Record<string, unknown>

export type ConfigurationNumberResult =
  | { valid: true; value: number }
  | { valid: false; reason: 'empty' | 'number' | 'integer' | 'minimum' | 'exclusiveMinimum' | 'maximum' | 'exclusiveMaximum' | 'multipleOf' }

export type ConfigurationDraftIdentity = {
  projectId: string
  projectRoot: string
  serviceId: string
  settingsPath: string
  schemaPath: string
}

const forbiddenPathSegments = new Set(['__proto__', 'prototype', 'constructor'])
const maxDraftBytes = 1_048_576
const maxDraftDepth = 64

export function configurationDraftKey(projectRoot: string, serviceId: string): string {
  return JSON.stringify([projectRoot, serviceId])
}

export function asConfigurationObject(value: unknown): ConfigurationObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as ConfigurationObject
}

export function cloneConfigurationObject(value: ConfigurationObject): ConfigurationObject {
  assertJSONValue(value, 0)
  const serialized = JSON.stringify(value)
  if (serialized.length > maxDraftBytes) throw new Error('Configuration draft exceeds the 1 MiB limit')
  return JSON.parse(serialized) as ConfigurationObject
}

export function mergeConfiguration(base: ConfigurationObject, patch: ConfigurationObject): ConfigurationObject {
  const result = cloneConfigurationObject(base)
  for (const [key, value] of Object.entries(patch)) {
    result[key] = mergeConfigurationValue(result[key], value)
  }
  return result
}

export function configurationPathIsJSONDocument(schema: ConfigurationObject, path: string[], values: ConfigurationObject): boolean {
  const field = schemaAtPath(schema, path, values)
  const resolved = field ? resolveConfigurationSchema(schema, field) : null
  return Boolean(resolved && (resolved['x-studio-json-document'] === true || resolved['x-studio-json-value'] === true))
}

export function configurationJSONDocumentPatch(value: unknown): ConfigurationObject {
  assertJSONValue(value, 0)
  return { [configurationJSONDocumentKey]: cloneJSONValue(value) }
}

export type ParsedConfigurationJSONDocument = { valid: true; value: unknown } | { valid: false }

export function parseConfigurationJSONDocument(source: string, allowAnyValue = false): ParsedConfigurationJSONDocument {
  try {
    if (new TextEncoder().encode(source).byteLength > maxDraftBytes) return { valid: false }
    const value: unknown = JSON.parse(source)
    if (!allowAnyValue && !asConfigurationObject(value)) return { valid: false }
    assertJSONValue(value, 0)
    const patch = JSON.stringify(configurationJSONDocumentPatch(value))
    if (new TextEncoder().encode(patch).byteLength > maxDraftBytes) return { valid: false }
    return { valid: true, value: cloneJSONValue(value) }
  } catch {
    return { valid: false }
  }
}

export function configurationValuesEqual(left: unknown, right: unknown): boolean {
  return jsonEqual(left, right)
}

export function updateConfigurationPatch(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  path: string[],
  value: unknown,
): ConfigurationObject {
  validatePath(path)
  assertJSONValue(value, 0)
  const next = cloneConfigurationObject(patch)
  setAtPath(next, path, cloneJSONValue(value))
  return jsonEqual(readAtPath(base, path), value) ? removeAtPath(next, path) : next
}

/** Refuses edits to unknown, read-only, write-only, or sensitive schema paths. */
export function configurationPathEditable(schema: ConfigurationObject, path: string[], nextValue?: unknown): boolean {
  if (path.length === 0 || path.length > 64) return false
  let current = resolveConfigurationSchema(schema, schema)
  for (const segment of path) {
    if (!current || configurationSchemaPathNodeSensitive(schema, current, segment)) return false
    const effective = effectiveConfigurationSchema(schema, current, {})
    if (!effective) return false
    if (schemaKind(effective) === 'array') {
      if (canonicalArrayIndex(segment) === null) return false
      const item = configurationSchemaArrayItem(schema, current)
      if (!item) return false
      current = item
      continue
    }
    const next = configurationSchemaChild(schema, current, segment)
    if (!next) return false
    current = next
  }
  const resolved = resolveConfigurationSchema(schema, current)
  if (!resolved) return false
  // Service-owned contract documents (for example an HTTP response JSON
  // Schema) are data, not user configuration objects. Their arbitrary
  // keywords must remain editable as one bounded JSON document, while nested
  // writes remain denied because the document intentionally has no open
  // per-key editor contract.
  if (resolved['x-studio-json-document'] === true) {
    return schemaKind(resolved) === 'object' && !configurationSchemaPathNodeSensitive(schema, resolved, path.at(-1) ?? '')
  }
  if (resolved['x-studio-json-value'] === true) {
    return !configurationSchemaPathNodeSensitive(schema, resolved, path.at(-1) ?? '')
  }
  // Replacing a whole array is unsafe when its items contain values hidden
  // from the renderer. Existing items can still be edited through sparse
  // index patches, which the host merges into the canonical project value.
  if ((schemaKind(resolved) === 'array' || schemaKind(resolved) === 'object' || 'oneOf' in resolved || 'anyOf' in resolved) && configurationSchemaContainsProtectedField(resolved)) {
    if (nextValue === undefined || !configurationSchemaHasSafeValue(schema, resolved, nextValue)) return false
  }
  return !configurationSchemaPathNodeSensitive(schema, resolved, path.at(-1) ?? '')
}

function configurationSchemaHasSafeValue(root: ConfigurationObject, value: unknown, nextValue: unknown, depth = 0): boolean {
  if (depth > 64) return false
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema) return false
  const variants = configurationSchemaVariants(root, schema)
  if (variants) return variants.some((variant) =>
    !configurationSchemaProtected(root, variant.schema) && configurationSchemaMatchesValue(root, variant.schema, nextValue))
  for (const keyword of ['oneOf', 'anyOf']) {
    const branches = schema[keyword]
    if (!Array.isArray(branches)) continue
    return branches.some((branch) => configurationSchemaHasSafeValue(root, branch, nextValue, depth + 1))
  }
  return !configurationSchemaProtected(root, schema) && configurationSchemaMatchesValue(root, schema, nextValue)
}

export function isSensitiveConfigurationFieldName(name: string | undefined): boolean {
  const normalized = name?.toLowerCase() ?? ''
  return ['secret', 'token', 'password', 'privatekey', 'authorization'].some((marker) => normalized.includes(marker))
}

export function configurationSchemaContainsProtectedField(schema: unknown): boolean {
  return configurationSchemaProtected(schema, schema)
}

export function isConfigurationPatchEmpty(patch: ConfigurationObject): boolean {
  return Object.keys(patch).length === 0
}

function mergeConfigurationValue(base: unknown, patch: unknown): unknown {
  const patchObject = asConfigurationObject(patch)
  if (patchObject && Object.hasOwn(patchObject, configurationJSONDocumentKey)) {
    if (!isConfigurationJSONDocumentPatch(patchObject)) throw new Error('JSON document draft marker is invalid')
    return cloneJSONValue(patchObject[configurationJSONDocumentKey])
  }
  if (Array.isArray(base) && patchObject) {
    let result = base.map(cloneJSONValue)
    if (Object.hasOwn(patchObject, configurationArrayOperationsKey)) {
      const operations = configurationArrayOperations(patchObject)
      if (!operations) throw new Error('Protected array draft operations are invalid')
      result = applyConfigurationArrayOperations(result, operations)
    }
    for (const [segment, value] of Object.entries(patchObject)) {
      if (segment === configurationArrayOperationsKey) continue
      const index = canonicalArrayIndex(segment)
      if (index === null || index >= result.length) throw new Error('Configuration array patch index is out of range')
      result[index] = mergeConfigurationValue(result[index], value)
    }
    return result
  }
  const baseObject = asConfigurationObject(base)
  if (baseObject && patchObject) {
    let result = cloneConfigurationObject(baseObject)
    if (Object.hasOwn(patchObject, configurationMapOperationsKey)) {
      const operations = configurationMapOperations(patchObject)
      if (!operations) throw new Error('Configuration map draft operations are invalid')
      for (const operation of operations) {
        if (!Object.hasOwn(result, operation.key)) throw new Error('Configuration map key is unavailable')
      }
      for (const operation of operations) {
        result = Object.fromEntries(Object.entries(result).filter(([key]) => key !== operation.key))
      }
    }
    for (const [key, value] of Object.entries(patchObject)) {
      if (key === configurationMapOperationsKey) continue
      result[key] = mergeConfigurationValue(result[key], value)
    }
    return result
  }
  return cloneJSONValue(patch)
}

function isConfigurationJSONDocumentPatch(value: unknown): value is ConfigurationObject {
  const object = asConfigurationObject(value)
  return Boolean(object && Object.hasOwn(object, configurationJSONDocumentKey) && Object.keys(object).length === 1)
}

export function updateConfigurationMapOperationPatch(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  schema: ConfigurationObject,
  path: string[],
  operation: ConfigurationMapOperation,
): ConfigurationObject {
  const projection = mergeConfiguration(base, patch)
  const values = readAtPath(projection, path)
  const rawMapSchema = schemaAtPath(schema, path, projection)
  const mapSchema = rawMapSchema ? effectiveConfigurationSchema(schema, rawMapSchema, values) : null
  const additional = asConfigurationObject(mapSchema?.additionalProperties)
  const properties = asConfigurationObject(mapSchema?.properties) ?? {}
  if (!asConfigurationObject(values) || !mapSchema || mapSchema.type !== 'object' || !additional ||
      mapSchema.patternProperties !== undefined || mapSchema.propertyNames !== undefined || mapSchema.dependentSchemas !== undefined ||
      configurationSchemaProtected(schema, additional)) {
    throw new Error('Configuration map does not have a safe typed contract')
  }
  if (!safeConfigurationMapKey(operation.key) || Object.hasOwn(properties, operation.key)) throw new Error('Configuration map key is not editable')
  const current = values as ConfigurationObject
  if (!Object.hasOwn(current, operation.key)) throw new Error('Configuration map key is unavailable')
  const minimum = typeof mapSchema.minProperties === 'number' && Number.isSafeInteger(mapSchema.minProperties) ? mapSchema.minProperties : 0
  if (Object.keys(current).length <= minimum) throw new Error('Configuration map is at its minimum property count')

  const existing = readAtPath(patch, path)
  const existingObject = existing === undefined ? {} : asConfigurationObject(existing)
  if (!existingObject) throw new Error('Configuration map draft cannot replace the map')
  const existingOperations = configurationMapOperations(existingObject)
  if (Object.hasOwn(existingObject, configurationMapOperationsKey) && !existingOperations) throw new Error('Configuration map draft operations are invalid')
  const operations = existingOperations ?? []
  const baseValues = asConfigurationObject(readAtPath(base, path)) ?? {}
  if (!Object.hasOwn(baseValues, operation.key) && Object.hasOwn(existingObject, operation.key)) {
    const next = cloneConfigurationObject(patch)
    const mapPatch = Object.fromEntries(Object.entries(existingObject).filter(([key]) => key !== operation.key))
    if (Object.keys(mapPatch).length === 0) return removeAtPath(next, path)
    else setAtPath(next, path, mapPatch)
    return next
  }
  if (operations.length >= 1024) throw new Error('Configuration map draft has too many operations')
  const next = cloneConfigurationObject(patch)
  const mapPatch: ConfigurationObject = Object.fromEntries(Object.entries(existingObject).filter(([key]) => key !== operation.key))
  mapPatch[configurationMapOperationsKey] = [...operations, operation]
  setAtPath(next, path, mapPatch)
  const resultingMap = mergeConfigurationValue(readAtPath(base, path), mapPatch)
  return configurationValuesEqual(readAtPath(base, path), resultingMap) ? removeAtPath(next, path) : next
}

export function isConfigurationMapOperationPath(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  schema: ConfigurationObject,
  path: string[],
): boolean {
  const projection = mergeConfiguration(base, patch)
  const rawMapSchema = schemaAtPath(schema, path, projection)
  const mapSchema = rawMapSchema ? effectiveConfigurationSchema(schema, rawMapSchema, readAtPath(projection, path)) : null
  return Boolean(asConfigurationObject(readAtPath(projection, path)) && mapSchema?.type === 'object' &&
    asConfigurationObject(mapSchema.additionalProperties) && mapSchema.patternProperties === undefined &&
    mapSchema.propertyNames === undefined && mapSchema.dependentSchemas === undefined &&
    !configurationSchemaProtected(schema, mapSchema.additionalProperties))
}

export function updateProtectedConfigurationArrayFieldPatch(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  schema: ConfigurationObject,
  path: string[],
  value: unknown,
): ConfigurationObject {
  const projection = mergeConfiguration(base, patch)
  const target = protectedArrayFieldTarget(schema, path, projection)
  if (!target || target.itemPath.length === 0) throw new Error('Protected array field path is not editable')
  const values = readAtPath(projection, target.arrayPath)
  if (!Array.isArray(values) || target.index >= values.length) throw new Error('Protected array item index is out of range')
  const currentItem = asConfigurationObject(values[target.index])
  if (!currentItem) throw new Error('Protected array item is not an editable object')
  const itemPatch = updateConfigurationPatch(currentItem, {}, target.itemPath, value)
  if (isConfigurationPatchEmpty(itemPatch)) return cloneConfigurationObject(patch)
  return appendProtectedArrayOperationPatch(patch, target.arrayPath, { op: 'set', index: target.index, patch: itemPatch })
}

export function isProtectedConfigurationArrayFieldPath(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  schema: ConfigurationObject,
  path: string[],
): boolean {
  const projection = mergeConfiguration(base, patch)
  const target = protectedArrayFieldTarget(schema, path, projection)
  if (!target || target.itemPath.length === 0) return false
  const values = readAtPath(projection, target.arrayPath)
  return Array.isArray(values) && target.index < values.length
}

export function isProtectedConfigurationArrayPath(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  schema: ConfigurationObject,
  path: string[],
): boolean {
  const projection = mergeConfiguration(base, patch)
  const values = readAtPath(projection, path)
  const arraySchema = schemaAtPath(schema, path, projection)
  if (!Array.isArray(values) || !arraySchema) return false
  if (effectiveConfigurationSchema(schema, arraySchema, values)?.type !== 'array') return false
  const itemSchema = configurationSchemaArrayItem(schema, arraySchema)
  return Boolean(itemSchema && configurationSchemaProtected(schema, itemSchema))
}

export function updateProtectedConfigurationArrayOperationPatch(
  base: ConfigurationObject,
  patch: ConfigurationObject,
  schema: ConfigurationObject,
  path: string[],
  operation: ConfigurationArrayOperation,
): ConfigurationObject {
  const projection = mergeConfiguration(base, patch)
  const values = readAtPath(projection, path)
  const arraySchema = schemaAtPath(schema, path, projection)
  if (!Array.isArray(values) || !arraySchema || effectiveConfigurationSchema(schema, arraySchema, values)?.type !== 'array') {
    throw new Error('Protected array path is not available')
  }
  const itemSchema = configurationSchemaArrayItem(schema, arraySchema)
  if (!itemSchema || !configurationSchemaProtected(schema, itemSchema)) throw new Error('Array does not require protected-value operations')
  const normalizedOperation = operation.op === 'insert'
    ? { ...operation, value: encodeJSONDocumentValues(schema, itemSchema, operation.value) }
    : operation
  const effective = effectiveConfigurationSchema(schema, arraySchema, values) ?? arraySchema
  switch (normalizedOperation.op) {
    case 'insert': {
      const maximum = numericBound(effective.maxItems, 1_000_000)
      if (normalizedOperation.index > values.length) throw new Error('Array insertion index is out of range')
      if (values.length >= maximum) throw new Error('Array is at its maximum item count')
      break
    }
    case 'remove':
      if (normalizedOperation.index >= values.length || values.length <= numericBound(effective.minItems, 0)) throw new Error('Array is at its minimum item count')
      break
    case 'move':
      if (normalizedOperation.from >= values.length || normalizedOperation.to >= values.length) throw new Error('Array move index is out of range')
      if (normalizedOperation.from === normalizedOperation.to) return cloneConfigurationObject(patch)
      break
    case 'swap':
      if (normalizedOperation.left >= values.length || normalizedOperation.right >= values.length) throw new Error('Array swap index is out of range')
      if (normalizedOperation.left === normalizedOperation.right) return cloneConfigurationObject(patch)
      break
    case 'duplicate':
      if (normalizedOperation.index >= values.length || normalizedOperation.to > values.length || values.length >= numericBound(effective.maxItems, 1_000_000)) throw new Error('Array is at its maximum item count')
      break
    case 'set':
      throw new Error('Field edits must use the schema-validated array field path')
  }
  const nextValues = applyConfigurationArrayOperations(values, [normalizedOperation])
  const enclosing = protectedArrayFieldTarget(schema, path, projection)
  if (enclosing && enclosing.itemPath.length > 0 && !samePath(enclosing.arrayPath, path)) {
    const nestedPatch: ConfigurationObject = {}
    setAtPath(nestedPatch, enclosing.itemPath, { [configurationArrayOperationsKey]: [cloneJSONValue(normalizedOperation)] })
    const nextPatch = appendProtectedArrayOperationPatch(patch, enclosing.arrayPath, {
      op: 'set',
      index: enclosing.index,
      patch: nestedPatch,
    })
    return nextPatch
  }
  const nextPatch = appendProtectedArrayOperationPatch(patch, path, normalizedOperation)
  // Structural edits are stored as safe operations rather than a replacement
  // array. Compact the operation history when it brings this collection back
  // to its canonical base value, so add-then-remove restores a genuinely clean
  // shared draft (and does not leave Save enabled for a no-op).
  return jsonEqual(readAtPath(base, path), nextValues) ? removeAtPath(nextPatch, path) : nextPatch
}

function encodeJSONDocumentValues(rootSchema: ConfigurationObject, schemaValue: unknown, value: unknown, depth = 0): unknown {
  if (depth > maxDraftDepth) throw new Error('Configuration value is too deeply nested')
  const schema = resolveConfigurationSchema(rootSchema, schemaValue)
  if (!schema) throw new Error('Configuration item schema is invalid')
  if (schema['x-studio-json-document'] === true || schema['x-studio-json-value'] === true) {
    const object = asConfigurationObject(value)
    if (!object && schema['x-studio-json-value'] !== true) throw new Error('JSON document must be an object')
    if (object && Object.hasOwn(object, configurationJSONDocumentKey) && Object.keys(object).length === 1) return cloneJSONValue(value)
    return configurationJSONDocumentPatch(value)
  }
  const effective = effectiveConfigurationSchema(rootSchema, schema, value)
  if (!effective) throw new Error('Configuration item schema is invalid')
  if (Array.isArray(value)) {
    const itemSchema = configurationSchemaArrayItem(rootSchema, schema)
    if (!itemSchema) return cloneJSONValue(value)
    return value.map((item) => encodeJSONDocumentValues(rootSchema, itemSchema, item, depth + 1))
  }
  const object = asConfigurationObject(value)
  if (!object) return cloneJSONValue(value)
  const additional = asConfigurationObject(effective.additionalProperties)
  const result: ConfigurationObject = {}
  for (const [key, child] of Object.entries(object)) {
    const childSchema = configurationSchemaChild(rootSchema, schema, key) ?? additional
    result[key] = childSchema ? encodeJSONDocumentValues(rootSchema, childSchema, child, depth + 1) : cloneJSONValue(child)
  }
  return result
}

function appendProtectedArrayOperationPatch(patch: ConfigurationObject, arrayPath: string[], operation: ConfigurationArrayOperation): ConfigurationObject {
  const existing = readAtPath(patch, arrayPath)
  const operations = normalizeProtectedArrayPatch(existing)
  if (operations.length >= 1024) throw new Error('Protected array draft has too many operations')
  const next = cloneConfigurationObject(patch)
  setAtPath(next, arrayPath, { [configurationArrayOperationsKey]: [...operations, cloneJSONValue(operation)] })
  return next
}

function normalizeProtectedArrayPatch(value: unknown): ConfigurationArrayOperation[] {
  if (value === undefined) return []
  const existingOperations = configurationArrayOperations(value)
  if (existingOperations) return existingOperations
  const object = asConfigurationObject(value)
  if (!object) throw new Error('Protected array draft cannot replace the collection')
  const operations: ConfigurationArrayOperation[] = []
  for (const [rawIndex, itemPatch] of Object.entries(object).sort(([left], [right]) => Number(left) - Number(right))) {
    const index = canonicalArrayIndex(rawIndex)
    const safePatch = asConfigurationObject(itemPatch)
    if (index === null || !safePatch || Object.keys(safePatch).length === 0) throw new Error('Protected array sparse draft is invalid')
    operations.push({ op: 'set', index, patch: cloneConfigurationObject(safePatch) })
  }
  return operations
}

function protectedArrayFieldTarget(rootSchema: ConfigurationObject, path: string[], values: ConfigurationObject): { arrayPath: string[]; index: number; itemPath: string[] } | null {
  let current = resolveConfigurationSchema(rootSchema, rootSchema)
  const prefix: string[] = []
  for (let position = 0; position < path.length; position += 1) {
    if (!current) return null
    const currentValue = readAtPath(values, prefix)
    const effective = effectiveConfigurationSchema(rootSchema, current, currentValue ?? {})
    if (effective?.type === 'array') {
      const itemSchema = configurationSchemaArrayItem(rootSchema, current)
      const index = canonicalArrayIndex(path[position] ?? '')
      if (itemSchema && configurationSchemaProtected(rootSchema, itemSchema)) {
        if (index === null) return null
        return { arrayPath: prefix, index, itemPath: path.slice(position + 1) }
      }
      if (index === null) return null
      current = itemSchema
    } else {
      current = configurationSchemaChild(rootSchema, current, path[position] ?? '')
    }
    prefix.push(path[position] ?? '')
  }
  return null
}

function schemaAtPath(rootSchema: ConfigurationObject, path: string[], values: ConfigurationObject): ConfigurationObject | null {
  let current = resolveConfigurationSchema(rootSchema, rootSchema)
  const prefix: string[] = []
  for (const segment of path) {
    if (!current) return null
    const value = readAtPath(values, prefix)
    if (effectiveConfigurationSchema(rootSchema, current, value ?? {})?.type === 'array') {
      const index = canonicalArrayIndex(segment)
      if (index === null) return null
      current = configurationSchemaArrayItem(rootSchema, current)
    } else {
      current = configurationSchemaChild(rootSchema, current, segment)
    }
    prefix.push(segment)
  }
  return current
}

function numericBound(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

/** Parses a numeric editor value without coercing empty or invalid input to zero. */
export function parseConfigurationNumber(input: string, schema: ConfigurationObject): ConfigurationNumberResult {
  const normalized = input.trim()
  if (normalized === '') return { valid: false, reason: 'empty' }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(normalized)) {
    return { valid: false, reason: 'number' }
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return { valid: false, reason: 'number' }
  if (schema.type === 'integer' && (!Number.isSafeInteger(value))) return { valid: false, reason: 'integer' }
  if (typeof schema.minimum === 'number' && value < schema.minimum) return { valid: false, reason: 'minimum' }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return { valid: false, reason: 'exclusiveMinimum' }
  if (typeof schema.maximum === 'number' && value > schema.maximum) return { valid: false, reason: 'maximum' }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return { valid: false, reason: 'exclusiveMaximum' }
  if (typeof schema.multipleOf === 'number') {
    if (schema.multipleOf <= 0) return { valid: false, reason: 'multipleOf' }
    const quotient = value / schema.multipleOf
    const nearestInteger = Math.round(quotient)
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8
    if (!Number.isFinite(quotient) || Math.abs(quotient - nearestInteger) > tolerance) {
      return { valid: false, reason: 'multipleOf' }
    }
  }
  return { valid: true, value }
}

function setAtPath(target: ConfigurationObject, path: string[], value: unknown): void {
  let cursor = target
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      cursor[segment] = value
      return
    }
    const child = asConfigurationObject(cursor[segment])
    const next = child ? cloneConfigurationObject(child) : {}
    cursor[segment] = next
    cursor = next
  })
}

function removeAtPath(target: ConfigurationObject, path: string[]): ConfigurationObject {
  const [segment, ...rest] = path
  if (!segment || !Object.hasOwn(target, segment)) return target
  if (rest.length === 0) return Object.fromEntries(Object.entries(target).filter(([key]) => key !== segment))
  const child = asConfigurationObject(target[segment])
  if (!child) return target
  const nextChild = removeAtPath(child, rest)
  if (Object.keys(nextChild).length === 0) return Object.fromEntries(Object.entries(target).filter(([key]) => key !== segment))
  return { ...target, [segment]: nextChild }
}

function readAtPath(root: ConfigurationObject, path: string[]): unknown {
  let cursor: unknown = root
  for (const segment of path) {
    const object = asConfigurationObject(cursor)
    if (object && Object.hasOwn(object, segment)) {
      cursor = object[segment]
      continue
    }
    if (Array.isArray(cursor)) {
      const index = canonicalArrayIndex(segment)
      if (index === null || index >= cursor.length) return undefined
      cursor = cursor[index]
      continue
    }
    return undefined
  }
  return cursor
}

function canonicalArrayIndex(segment: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return null
  const index = Number(segment)
  return Number.isSafeInteger(index) ? index : null
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

function validatePath(path: string[]): void {
  if (path.length === 0 || path.length > 64 || path.some((segment) =>
    segment.length === 0 || segment.length > 256 || forbiddenPathSegments.has(segment))) {
    throw new Error('Invalid configuration field path')
  }
}

function assertJSONValue(value: unknown, depth: number): void {
  if (depth > maxDraftDepth) throw new Error('Configuration draft exceeds the nesting limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Configuration values must be finite JSON numbers')
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertJSONValue(entry, depth + 1)
    return
  }
  const object = asConfigurationObject(value)
  if (!object || (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null)) {
    throw new Error('Configuration draft contains a non-JSON value')
  }
  for (const [key, entry] of Object.entries(object)) {
    if (forbiddenPathSegments.has(key)) throw new Error('Configuration draft contains a forbidden key')
    assertJSONValue(entry, depth + 1)
  }
}

function cloneJSONValue(value: unknown): unknown {
  assertJSONValue(value, 0)
  return JSON.parse(JSON.stringify(value)) as unknown
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]))
  }
  const leftObject = asConfigurationObject(left)
  const rightObject = asConfigurationObject(right)
  if (!leftObject || !rightObject) return false
  const leftKeys = Object.keys(leftObject).sort()
  const rightKeys = Object.keys(rightObject).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && jsonEqual(leftObject[key], rightObject[key]))
}

function sensitiveSchemaNode(schema: ConfigurationObject, propertyName?: string): boolean {
  return schema.readOnly === true || schema.writeOnly === true || schema['x-sensitive'] === true ||
    schema['x-secret'] === true || schema['x-redacted'] === true || schema['x-liapoldus-sensitive'] === true ||
    schema.format === 'password' || isSensitiveConfigurationFieldName(propertyName)
}

function configurationSchemaPathNodeSensitive(root: ConfigurationObject, value: ConfigurationObject, propertyName: string, depth = 0, seen = new Set<ConfigurationObject>()): boolean {
  const schema = resolveConfigurationSchema(root, value, depth)
  if (!schema || depth > 64 || seen.has(schema) || sensitiveSchemaNode(schema, propertyName)) return true
  const nextSeen = new Set(seen)
  nextSeen.add(schema)
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else']) {
    if (schema[keyword] === undefined) continue
    const branches = Array.isArray(schema[keyword]) ? schema[keyword] as unknown[] : [schema[keyword]]
    if (branches.some((branch) => {
      const branchSchema = asConfigurationObject(branch)
      return !branchSchema || configurationSchemaPathNodeSensitive(root, branchSchema, propertyName, depth + 1, nextSeen)
    })) return true
  }
  return false
}

function schemaKind(schema: ConfigurationObject): string {
  return typeof schema.type === 'string' ? schema.type : ''
}
