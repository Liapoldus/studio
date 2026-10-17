type ConfigurationRecord = Record<string, unknown>

export const configurationMapOperationsKey = '$studioMapOps/v1'

export type ConfigurationMapOperation = { op: 'remove'; key: string }

export function configurationMapOperationRequest(operation: ConfigurationMapOperation): ConfigurationRecord {
  return { [configurationMapOperationsKey]: [{ ...operation }] }
}

export function configurationMapOperations(value: unknown): ConfigurationMapOperation[] | null {
  const object = asRecord(value)
  if (!object || !Array.isArray(object[configurationMapOperationsKey])) return null
  const rawOperations = object[configurationMapOperationsKey]
  if (rawOperations.length === 0 || rawOperations.length > 1024) return null
  const result: ConfigurationMapOperation[] = []
  for (const raw of rawOperations) {
    const operation = asRecord(raw)
    if (!operation || operation.op !== 'remove' || Object.keys(operation).length !== 2 ||
        typeof operation.key !== 'string' || !safeConfigurationMapKey(operation.key)) return null
    result.push({ op: 'remove', key: operation.key })
  }
  return result
}

export function isConfigurationMapOperationRequest(value: unknown): boolean {
  const object = asRecord(value)
  return Boolean(object && Object.keys(object).length === 1 && configurationMapOperations(object))
}

export function safeConfigurationMapKey(value: string): boolean {
  const normalized = value.toLowerCase()
  return value.length > 0 && value.length <= 128 &&
    value !== configurationMapOperationsKey &&
    !['__proto__', 'prototype', 'constructor'].includes(value) &&
    !['secret', 'token', 'password', 'privatekey', 'authorization'].some((marker) => normalized.includes(marker))
}

export function removeConfigurationMapKey(value: unknown, key: string): ConfigurationRecord {
  const object = asRecord(value)
  if (!object || !safeConfigurationMapKey(key) || !Object.hasOwn(object, key)) {
    throw new Error('Configuration map key is unavailable')
  }
  return Object.fromEntries(Object.entries(object).filter(([entryKey]) => entryKey !== key))
}

function asRecord(value: unknown): ConfigurationRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as ConfigurationRecord
}
