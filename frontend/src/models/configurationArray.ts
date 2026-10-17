type SchemaRecord = Record<string, unknown>

export const configurationArrayOperationsKey = '$studioArrayOps/v1'
export const configurationJSONDocumentKey = '$studioJSONDocument/v1'

export type ConfigurationArrayOperation =
  | { op: 'set'; index: number; patch: SchemaRecord }
  | { op: 'remove'; index: number }
  | { op: 'insert'; index: number; value: unknown }
  | { op: 'move'; from: number; to: number }
  | { op: 'swap'; left: number; right: number }
  | { op: 'duplicate'; index: number; to: number }

export function configurationArrayOperationRequest(operation: ConfigurationArrayOperation): SchemaRecord {
  return { [configurationArrayOperationsKey]: [cloneJSON(operation)] }
}

export function configurationArrayOperations(value: unknown): ConfigurationArrayOperation[] | null {
  const object = asRecord(value)
  if (!object || Object.keys(object).length !== 1 || !Array.isArray(object[configurationArrayOperationsKey])) return null
  const operations = object[configurationArrayOperationsKey]
  if (operations.length === 0 || operations.length > 1024) return null
  const result: ConfigurationArrayOperation[] = []
  for (const raw of operations) {
    const operation = asRecord(raw)
    if (!operation || typeof operation.op !== 'string') return null
    switch (operation.op) {
      case 'set':
        {
          const index = operation.index
          const valuePatch = asRecord(operation.patch)
          if (Object.keys(operation).length !== 3 || !safeIndex(index) || !valuePatch || Object.keys(valuePatch).length === 0) return null
          result.push({ op: 'set', index, patch: valuePatch })
        }
        break
      case 'remove':
        {
          const index = operation.index
          if (Object.keys(operation).length !== 2 || !safeIndex(index)) return null
          result.push({ op: 'remove', index })
        }
        break
      case 'insert':
        {
          const index = operation.index
          if (Object.keys(operation).length !== 3 || !safeIndex(index) || !Object.hasOwn(operation, 'value')) return null
          try { assertJSONValue(operation.value, 0) } catch { return null }
          result.push({ op: 'insert', index, value: cloneJSON(operation.value) })
        }
        break
      case 'move':
        {
          const from = operation.from
          const to = operation.to
          if (Object.keys(operation).length !== 3 || !safeIndex(from) || !safeIndex(to)) return null
          result.push({ op: 'move', from, to })
        }
        break
      case 'swap':
        {
          const left = operation.left
          const right = operation.right
          if (Object.keys(operation).length !== 3 || !safeIndex(left) || !safeIndex(right)) return null
          result.push({ op: 'swap', left, right })
        }
        break
      case 'duplicate':
        {
          const index = operation.index
          const to = operation.to
          if (Object.keys(operation).length !== 3 || !safeIndex(index) || !safeIndex(to)) return null
          result.push({ op: 'duplicate', index, to })
        }
        break
      default:
        return null
    }
  }
  return result
}

export function applyConfigurationArrayOperations(values: unknown[], operations: ConfigurationArrayOperation[]): unknown[] {
  let result = values.map(cloneJSON)
  for (const operation of operations) {
    switch (operation.op) {
      case 'set':
        assertIndex(result, operation.index)
        result[operation.index] = mergeArrayValue(result[operation.index], operation.patch)
        break
      case 'remove':
        assertIndex(result, operation.index)
        result = result.filter((_value, index) => index !== operation.index)
        break
      case 'insert':
        if (!Number.isSafeInteger(operation.index) || operation.index < 0 || operation.index > result.length) throw new RangeError('Array insertion index is out of range')
        result.splice(operation.index, 0, unwrapJSONDocumentMarkers(operation.value))
        break
      case 'move': {
        assertIndex(result, operation.from)
        assertIndex(result, operation.to)
        const [item] = result.splice(operation.from, 1)
        result.splice(operation.to, 0, item)
        break
      }
      case 'swap':
        assertIndex(result, operation.left)
        assertIndex(result, operation.right)
        ;[result[operation.left], result[operation.right]] = [result[operation.right], result[operation.left]]
        break
      case 'duplicate':
        assertIndex(result, operation.index)
        if (!Number.isSafeInteger(operation.to) || operation.to < 0 || operation.to > result.length) throw new RangeError('Array insertion index is out of range')
        result.splice(operation.to, 0, cloneJSON(result[operation.index]))
        break
    }
  }
  return result
}

export function createConfigurationArrayItem(schemaValue: unknown): unknown {
  const schema = asRecord(schemaValue)
  if (!schema) return null
  if (Object.hasOwn(schema, 'default')) return cloneJSON(schema.default)
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return cloneJSON(schema.enum[0])

  switch (schema.type) {
    case 'object': {
      const properties = asRecord(schema.properties) ?? {}
      const required = new Set(Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : [])
      const result: SchemaRecord = {}
      for (const [key, rawChild] of Object.entries(properties)) {
        const child = asRecord(rawChild)
        if (child && (required.has(key) || Object.hasOwn(child, 'default'))) result[key] = createConfigurationArrayItem(child)
      }
      return result
    }
    case 'array': return []
    case 'boolean': return false
    case 'integer':
    case 'number': return typeof schema.minimum === 'number' ? schema.minimum : 0
    case 'string': return ''
    case 'null': return null
    default: return null
  }
}

export function duplicateConfigurationArrayItem(values: unknown[], index: number): unknown[] {
  assertIndex(values, index)
  const next = values.map(cloneJSON)
  next.splice(index + 1, 0, cloneJSON(values[index]))
  return next
}

export function removeConfigurationArrayItem(values: unknown[], index: number, minItems = 0): unknown[] {
  assertIndex(values, index)
  if (values.length <= minItems) throw new Error('Array is at its minimum item count')
  return values.filter((_value, itemIndex) => itemIndex !== index)
}

export function moveConfigurationArrayItem(values: unknown[], index: number, offset: -1 | 1): unknown[] {
  assertIndex(values, index)
  const target = index + offset
  if (target < 0 || target >= values.length) return values
  const next = [...values]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function reorderConfigurationArrayItem(values: unknown[], from: number, to: number): unknown[] {
  assertIndex(values, from)
  assertIndex(values, to)
  if (from === to) return values
  const next = [...values]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function assertIndex(values: unknown[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new RangeError('Array item index is out of range')
}

function safeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
}

function assertJSONValue(value: unknown, depth: number, seen = new Set<object>()): void {
  if (depth > 64) throw new TypeError('Array operation value is too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Array operation value is cyclic')
    seen.add(value)
    for (const child of value) assertJSONValue(child, depth + 1, seen)
    seen.delete(value)
    return
  }
  const object = asRecord(value)
  if (object) {
    if (seen.has(object)) throw new TypeError('Array operation value is cyclic')
    seen.add(object)
    for (const [key, child] of Object.entries(object)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Array operation value has an unsafe key')
      assertJSONValue(child, depth + 1, seen)
    }
    seen.delete(object)
    return
  }
  throw new TypeError('Array operation value is not JSON-safe')
}

function mergeArrayValue(current: unknown, patch: unknown): unknown {
  const patchObject = asRecord(patch)
  if (patchObject && Object.hasOwn(patchObject, configurationJSONDocumentKey)) {
    if (Object.keys(patchObject).length !== 1) throw new Error('JSON document draft marker is invalid')
    return cloneJSON(patchObject[configurationJSONDocumentKey])
  }
  if (Array.isArray(current) && patchObject) {
    const result = current.map(cloneJSON)
    if (Object.hasOwn(patchObject, configurationArrayOperationsKey)) {
      const operations = configurationArrayOperations(patchObject)
      if (!operations) throw new Error('Protected array draft operations are invalid')
      return applyConfigurationArrayOperations(result, operations)
    }
    for (const [segment, value] of Object.entries(patchObject)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) throw new Error('Array patch index is invalid')
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index >= result.length) throw new Error('Array patch index is out of range')
      result[index] = mergeArrayValue(result[index], value)
    }
    return result
  }
  const currentObject = asRecord(current)
  if (currentObject && patchObject) {
    const result: SchemaRecord = { ...currentObject }
    for (const [key, value] of Object.entries(patchObject)) result[key] = mergeArrayValue(result[key], value)
    return result
  }
  return cloneJSON(patch)
}

function unwrapJSONDocumentMarkers(value: unknown): unknown {
  const object = asRecord(value)
  if (object && Object.hasOwn(object, configurationJSONDocumentKey)) {
    if (Object.keys(object).length !== 1) throw new Error('JSON document draft marker is invalid')
    return cloneJSON(object[configurationJSONDocumentKey])
  }
  if (Array.isArray(value)) return value.map(unwrapJSONDocumentMarkers)
  if (object) return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, unwrapJSONDocumentMarkers(child)]))
  return value
}

function cloneJSON(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function asRecord(value: unknown): SchemaRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as SchemaRecord : null
}
