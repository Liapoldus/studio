import { configurationArrayOperationsKey, configurationJSONDocumentKey } from './configurationArray.js'
import { configurationMapOperationsKey } from './configurationMap.js'
import { configurationValuesEqual, mergeConfiguration, type ConfigurationObject } from './configurationDraft.js'

const reviewSensitiveSegments = new Set([
  'routes', 'route', 'listeners', 'listener', 'tls', 'auth', 'secret', 'secretref', 'secretrefs',
  'credentials', 'apikey', 'bearer', 'basic', 'cors', 'trustedproxies', 'headers', 'redirect',
  'rewrite', 'ratelimit', 'healthcheck', 'cache', 'compression', 'security', 'certificate',
  'certificates', 'domain', 'domains', 'host', 'hostname', 'bind', 'address', 'allowlist', 'denylist',
])
const reviewRootSegments = new Set(['routes', 'listeners', 'defaults'])
const maximumPaths = 64
const maximumDepth = 64
const reviewSafeValueKeys = new Set([
  'type', 'method', 'mode', 'scheme', 'visibility', 'enabled', 'allowcredentials', 'port', 'order',
  'maxageseconds', 'maxbytes', 'requestspersecond', 'burst', 'intervalseconds', 'timeoutseconds',
  'maxconnsperhost', 'maxidleconnsperhost', 'healthcheckintervalseconds', 'healthchecktimeoutseconds',
])
const reviewSafeEnumValues = new Set([
  'service', 'static', 'reverseproxy', 'redirect', 'enabled', 'disabled', 'inherit', 'bearer', 'apikey',
  'basic', 'public', 'private', 'get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'connect',
  'http1', 'http2', 'http3', 'automatic', 'manual', 'roundrobin', 'weightedroundrobin',
])
const reviewPathSegments = new Set([
  'config', 'routes', 'listeners', 'defaults', 'handler', 'features', 'match', 'api', 'tls', 'auth',
  'cors', 'cache', 'compression', 'headers', 'rewrite', 'ratelimit', 'healthcheck', 'path', 'method',
  'type', 'mode', 'scheme', 'enabled', 'allowcredentials', 'hostnames', 'listenerid', 'serviceid',
  'secretref', 'certificateRef', 'privateKeyRef', 'upstreams', 'health', 'response', 'request',
  'visibility', 'maxageseconds', 'maxbytes', 'requestspersecond', 'burst', 'intervalseconds',
  'address',
])

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function safePath(path: string[]): string | null {
  if (path.length === 0 || path.length > maximumDepth) return null
  const parts = path.filter((part) => reviewSensitiveSegments.has(part.toLowerCase()) || reviewRootSegments.has(part.toLowerCase()))
    .map((part) => part.toLowerCase() === 'ratelimit' ? 'rateLimit'
      : part.toLowerCase() === 'secretref' ? 'secretRef'
        : part.toLowerCase() === 'trustedproxies' ? 'trustedProxies' : part.toLowerCase())
  if (parts.length === 0 || parts.length > 12) return null
  return parts.join('.')
}

function isReviewSensitive(path: string[]): boolean {
  return path.some((part) => reviewSensitiveSegments.has(part.toLowerCase()))
}

/** Returns changed public/security-sensitive paths without reading or exposing values. */
export function configurationApplyReviewPaths(patch: Record<string, unknown>): string[] {
  const paths = new Set<string>()
  function visit(value: unknown, path: string[], depth: number): void {
    if (depth > maximumDepth || paths.size >= maximumPaths) return
    if (isReviewSensitive(path)) {
      const label = safePath(path)
      if (label) paths.add(label)
      return
    }
    const object = record(value)
    if (!object || path.length === 0) return
    if (Object.hasOwn(object, configurationJSONDocumentKey) ||
        Object.hasOwn(object, configurationArrayOperationsKey) ||
        Object.hasOwn(object, configurationMapOperationsKey)) {
      const label = safePath(path)
      if (label && isReviewSensitive(path)) paths.add(label)
      return
    }
    const entries = Object.entries(object)
    if (entries.length === 0) return
    for (const [key, child] of entries) visit(child, [...path, key], depth + 1)
  }
  for (const [key, value] of Object.entries(patch)) visit(value, [key], 1)
  return [...paths].sort().slice(0, maximumPaths)
}

/** Builds a bounded review summary from before/after values without retaining secret material. */
export function configurationApplyReviewDiff(base: ConfigurationObject, patch: ConfigurationObject): string[] {
  let next: ConfigurationObject
  try {
    next = mergeConfiguration(base, patch)
  } catch {
    return configurationApplyReviewPaths(patch)
  }
  const changes = new Set<string>()

  function visit(before: unknown, after: unknown, path: string[], depth: number): void {
    if (depth > maximumDepth || changes.size >= maximumPaths || configurationValuesEqual(before, after)) return
    if (!isReviewSensitive(path)) {
      const object = record(after) ?? record(before)
      if (!object) return
      const beforeObject = record(before)
      const afterObject = record(after)
      if (Object.hasOwn(object, configurationJSONDocumentKey) ||
          Object.hasOwn(object, configurationArrayOperationsKey) ||
          Object.hasOwn(object, configurationMapOperationsKey)) return
      for (const key of new Set([...Object.keys(beforeObject ?? {}), ...Object.keys(afterObject ?? {})])) {
        visit(beforeObject?.[key], afterObject?.[key], [...path, key], depth + 1)
      }
      return
    }

    const beforeObject = record(before)
    const afterObject = record(after)
    if ((before === undefined || after === undefined) &&
        (beforeObject || afterObject || Array.isArray(before) || Array.isArray(after))) {
      addChange(path, before, after)
      return
    }
    if ((beforeObject || afterObject) && !Object.hasOwn(beforeObject ?? {}, configurationJSONDocumentKey) &&
        !Object.hasOwn(afterObject ?? {}, configurationJSONDocumentKey) &&
        !Object.hasOwn(beforeObject ?? {}, configurationArrayOperationsKey) &&
        !Object.hasOwn(afterObject ?? {}, configurationArrayOperationsKey) &&
        !Object.hasOwn(beforeObject ?? {}, configurationMapOperationsKey) &&
        !Object.hasOwn(afterObject ?? {}, configurationMapOperationsKey)) {
      for (const key of new Set([...Object.keys(beforeObject ?? {}), ...Object.keys(afterObject ?? {})])) {
        visit(beforeObject?.[key], afterObject?.[key], [...path, key], depth + 1)
      }
      if (Object.keys(beforeObject ?? {}).length === 0 && Object.keys(afterObject ?? {}).length === 0) {
        addChange(path, before, after)
      }
      return
    }
    if (Array.isArray(before) || Array.isArray(after)) {
      const beforeItems = Array.isArray(before) ? before : []
      const afterItems = Array.isArray(after) ? after : []
      for (let index = 0; index < Math.max(beforeItems.length, afterItems.length); index += 1) {
        visit(beforeItems[index], afterItems[index], [...path, String(index)], depth + 1)
      }
      if (beforeItems.length === 0 && afterItems.length === 0) addChange(path, before, after)
      return
    }
    addChange(path, before, after)
  }

  function addChange(path: string[], before: unknown, after: unknown): void {
    const label = reviewDiffPath(path)
    if (!label) return
    const key = path.at(-1)?.toLowerCase() ?? ''
    if (isValueSensitive(path) || isCollectionEntryChange(path)) {
      const action = before === undefined ? 'added' : after === undefined ? 'removed' : 'replaced'
      changes.add(`${label}: ${action} (value-redacted)`)
      return
    }
    changes.add(`${label}: ${reviewValue(before, key)} to ${reviewValue(after, key)}`)
  }

  visit(base, next, [], 0)
  if (changes.size === 0) return configurationApplyReviewPaths(patch)
  return [...changes].sort().slice(0, maximumPaths)
}

function reviewDiffPath(path: string[]): string | null {
  if (path.length === 0 || path.length > 16) return null
  const parts = path.map((part) => {
    if (/^\d+$/u.test(part)) return `item-${String(Number(part) + 1)}`
    return reviewPathSegments.has(part.toLowerCase()) ? part.toLowerCase() : 'field'
  })
  return parts.join('.')
}

function isValueSensitive(path: string[]): boolean {
  return path.some((part) => ['secret', 'secretref', 'secretrefs', 'token', 'password', 'privatekey', 'credential', 'authorization', 'address'].includes(part.toLowerCase())) ||
    path.some((part) => part.toLowerCase() === 'headers')
}

function isCollectionEntryChange(path: string[]): boolean {
  return path.some((part, index) =>
    ['routes', 'listeners'].includes(part.toLowerCase()) && path.length === index + 2,
  )
}

function reviewValue(value: unknown, key: string): string {
  if (value === undefined) return 'absent'
  if (!reviewSafeValueKeys.has(key)) return 'changed'
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && reviewSafeEnumValues.has(value.toLowerCase())) return value
  if (Array.isArray(value) && value.length <= 32) return `${String(value.length)}-items`
  return 'changed'
}
