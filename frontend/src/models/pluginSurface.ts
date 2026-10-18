export type StudioPluginSurfaceReference = {
  kind: string
  studioPluginId?: string
  studioPluginVersion?: string
  surfaceId?: string
  route?: string
}

const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u
const safeRequestID = /^[A-Za-z0-9._:-]{1,64}$/u
const safeSessionID = /^[a-f0-9]{32}$/u
const safeBridgeErrorCode = /^bridge\.[a-z0-9_.-]{1,96}$/u
const safeCLIErrorCode = /^([a-z][a-z0-9_.-]{0,63})(?::|$)/u

/** Retain only a bounded typed CLI code; never forward its potentially sensitive message. */
export function studioPluginBridgeFailureCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (safeBridgeErrorCode.test(message)) return message
  const cliFailure = /^liapoldus:\s+(.+)$/u.exec(message)?.[1]
  const cliCode = cliFailure ? safeCLIErrorCode.exec(cliFailure)?.[1] : undefined
  if (cliCode) return `bridge.cli.${cliCode}`
  return safeBridgeErrorCode.test(fallback) ? fallback : 'bridge.operation_failed'
}

export const studioServiceEditorBridgeVersion = 'studio-service-editor/v2'
export type StudioPluginBridgeMethod = 'context.get' | 'service.settings.read' | 'service.configuration-ui.read' | 'service.resource.list' | 'service.admin-surface.read' | 'service.admin.table.query' | 'service.admin.action.invoke' | 'service.resource.artifact.select' | 'service.resource.publish' | 'service.resource.operation.watch' | 'service.peer.catalog.read' | 'service.secret.references.read' | 'service.settings.secret-reference.select' | 'service.settings.recovery.copy' | 'service.settings.patch' | 'service.settings.save'
export type StudioPluginBridgeRequest = {
  type: 'studio.bridge.request'
  schemaVersion: typeof studioServiceEditorBridgeVersion
  sessionId: string
  requestId: string
  method: StudioPluginBridgeMethod
  payload?: unknown
}

export function studioPluginPermissionGranted(declared: readonly string[] | ReadonlySet<string> | undefined, granted: readonly string[] | ReadonlySet<string> | undefined, permission: string): boolean {
  const contains = (source: readonly string[] | ReadonlySet<string> | undefined) => {
    if (!source) return false
    return 'has' in source ? source.has(permission) : source.includes(permission)
  }
  return contains(declared) && contains(granted)
}

export function studioPluginSurfaceAssetURL(surface: StudioPluginSurfaceReference): string | null {
  if (surface.kind !== 'studio-plugin' || !surface.studioPluginId || !surface.studioPluginVersion || !surface.surfaceId || !surface.route) return null
  const route = surface.route
  if (route.startsWith('/') || route.includes('\\') || route.includes('\u0000') || route.includes('?') || route.includes('#')) return null
  const routeParts = route.split('/')
  if (routeParts.some((part) => !safeSegment.test(part) || part === '.' || part === '..')) return null
  if (!/\.html?$/iu.test(routeParts.at(-1) ?? '')) return null
  const identity = [surface.studioPluginId, surface.studioPluginVersion, surface.surfaceId]
  if (identity.some((part) => !safeSegment.test(part))) return null
  return `/studio-plugin-assets/${[...identity, ...routeParts].map(encodeURIComponent).join('/')}`
}

export function isStudioPluginSurfaceReadyMessage(value: unknown, expectedSessionID?: string): value is { type: 'studio.surface.ready'; schemaVersion: typeof studioServiceEditorBridgeVersion; sessionId: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return keys.length === 3 && keys[0] === 'schemaVersion' && keys[1] === 'sessionId' && keys[2] === 'type'
    && record.type === 'studio.surface.ready'
    && record.schemaVersion === studioServiceEditorBridgeVersion
    && typeof record.sessionId === 'string' && safeSessionID.test(record.sessionId)
    && (expectedSessionID === undefined || record.sessionId === expectedSessionID)
}

export function parseStudioPluginBridgeRequest(value: unknown): StudioPluginBridgeRequest | null {
  if (!isJSONObject(value)) return null
  const entries = value
  const allowedKeys = new Set(['type', 'schemaVersion', 'sessionId', 'requestId', 'method', 'payload'])
  if (Object.keys(entries).some((key) => !allowedKeys.has(key))) return null
  if (entries.type !== 'studio.bridge.request' || entries.schemaVersion !== studioServiceEditorBridgeVersion ||
      typeof entries.sessionId !== 'string' || !safeSessionID.test(entries.sessionId) ||
      typeof entries.requestId !== 'string' || !safeRequestID.test(entries.requestId) ||
      !['context.get', 'service.settings.read', 'service.configuration-ui.read', 'service.resource.list', 'service.admin-surface.read', 'service.admin.table.query', 'service.admin.action.invoke', 'service.resource.artifact.select', 'service.resource.publish', 'service.resource.operation.watch', 'service.peer.catalog.read', 'service.secret.references.read', 'service.settings.secret-reference.select', 'service.settings.recovery.copy', 'service.settings.patch', 'service.settings.save'].includes(String(entries.method))) return null
  if (entries.method === 'service.settings.patch') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).some((key) => key !== 'path' && key !== 'value') ||
        !Array.isArray(payload.path) || payload.path.length === 0 || payload.path.length > 64 ||
        payload.path.some((segment) => typeof segment !== 'string' || segment.length === 0 || segment.length > 256 ||
          ['__proto__', 'prototype', 'constructor'].includes(segment)) || !Object.hasOwn(payload, 'value')) return null
  } else if (entries.method === 'service.resource.list') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || typeof payload.resourceId !== 'string' || !safeSegment.test(payload.resourceId)) return null
  } else if (entries.method === 'service.peer.catalog.read' && entries.payload !== undefined) {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || typeof payload.targetServiceId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(payload.targetServiceId)) return null
  } else if (entries.method === 'service.secret.references.read') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || typeof payload.purpose !== 'string' ||
        !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u.test(payload.purpose) || payload.purpose.length > 192) return null
  } else if (entries.method === 'service.settings.secret-reference.select') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 3 || !Array.isArray(payload.path) || payload.path.length === 0 || payload.path.length > 64 ||
        payload.path.some((segment) => typeof segment !== 'string' || segment.length === 0 || segment.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(segment)) ||
        typeof payload.purpose !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u.test(payload.purpose) || payload.purpose.length > 192 ||
        typeof payload.reference !== 'string' || !/^ssr:v1:[a-f0-9]{32}$/u.test(payload.reference)) return null
  } else if (entries.method === 'service.settings.recovery.copy') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || typeof payload.baseDigest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(payload.baseDigest)) return null
  } else if (entries.method === 'service.admin-surface.read' && entries.payload !== undefined) {
    return null
  } else if (entries.method === 'service.admin.table.query') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).some((key) => !['pageId', 'sectionId', 'surfaceDigest', 'cursor'].includes(key)) ||
        typeof payload.pageId !== 'string' || !safeSegment.test(payload.pageId) ||
        typeof payload.sectionId !== 'string' || !safeSegment.test(payload.sectionId) ||
        typeof payload.surfaceDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(payload.surfaceDigest) ||
        (payload.cursor !== undefined && (typeof payload.cursor !== 'string' || payload.cursor.length > 1024 || /[\0\r\n]/u.test(payload.cursor)))) return null
  } else if (entries.method === 'service.admin.action.invoke') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).some((key) => !['pageId', 'sectionId', 'actionId', 'input', 'surfaceDigest', 'ifMatch'].includes(key)) ||
        typeof payload.pageId !== 'string' || !safeSegment.test(payload.pageId) ||
        typeof payload.sectionId !== 'string' || !safeSegment.test(payload.sectionId) ||
        typeof payload.actionId !== 'string' || !safeSegment.test(payload.actionId) ||
        typeof payload.surfaceDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(payload.surfaceDigest) ||
        !isJSONObject(payload.input) || !safeServiceActionMetadata(payload.input) ||
        (payload.ifMatch !== undefined && (typeof payload.ifMatch !== 'string' || payload.ifMatch.length > 512 || /[\0\r\n]/u.test(payload.ifMatch)))) return null
  } else if (entries.method === 'service.resource.artifact.select' && entries.payload !== undefined) {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || payload.source !== 'project-directory') return null
  } else if (entries.method === 'service.resource.publish') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).some((key) => !['pageId', 'actionId', 'artifactPath', 'contentType', 'metadata', 'ifMatch'].includes(key)) ||
        typeof payload.pageId !== 'string' || !safeSegment.test(payload.pageId) ||
        typeof payload.actionId !== 'string' || !safeSegment.test(payload.actionId) ||
        typeof payload.artifactPath !== 'string' || !safeProjectRelativePath(payload.artifactPath) ||
        typeof payload.contentType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(payload.contentType) ||
        !isJSONObject(payload.metadata) || !safeServiceActionMetadata(payload.metadata) ||
        (payload.ifMatch !== undefined && (typeof payload.ifMatch !== 'string' || payload.ifMatch.length > 512 || /[\0\r\n]/u.test(payload.ifMatch)))) return null
  } else if (entries.method === 'service.resource.operation.watch') {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || typeof payload.operationId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(payload.operationId)) return null
  } else if (entries.method === 'service.settings.save' && entries.payload !== undefined) {
    const payload = entries.payload
    if (!isJSONObject(payload) || Object.keys(payload).length !== 1 || payload.allowIncomplete !== true) return null
  } else if (entries.payload !== undefined) {
    return null
  }
  try {
    const encoded = JSON.stringify(value)
    if (encoded.length > 65_536) return null
    if (entries.payload !== undefined && !safeJSONValue(entries.payload, 0)) return null
  } catch {
    return null
  }
  return value as StudioPluginBridgeRequest
}

function safeProjectRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 512 || value.startsWith('/') || value.includes('\\') || /[\0\r\n]/u.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.startsWith('.'))
}

function safeServiceActionMetadata(value: unknown, depth = 0): boolean {
  if (depth > 16) return false
  if (Array.isArray(value)) return value.length <= 512 && value.every((item) => safeServiceActionMetadata(item, depth + 1))
  if (!isJSONObject(value)) return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  if (Object.keys(value).length > 512) return false
  return Object.entries(value).every(([key, child]) =>
    !/(?:secret|password|passwd|token|private.?key|credential|authorization|authkey)/iu.test(key) &&
    safeServiceActionMetadata(child, depth + 1))
}

/**
 * Bounds host-side peer catalog work independently of iframe timers. Sandboxed
 * WebViews can suspend plugin timers while the host remains active; without an
 * independent deadline the editor can be left in a permanent loading state.
 */
export function withPeerCatalogDeadline<T>(request: Promise<T>, timeoutMs = 9_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('bridge.peer_catalog_timeout'))
    }, timeoutMs)
    request.then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (reason: unknown) => {
        clearTimeout(timeout)
        reject(reason instanceof Error ? reason : new Error('bridge.peer_catalog_unavailable'))
      },
    )
  })
}

export function createStudioBridgeSessionID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function startStudioPluginHandshake(sendReady: () => void, schedule: (callback: () => void, delayMillis: number) => unknown, cancel: (handle: unknown) => void): () => void {
  sendReady()
  const handle = schedule(sendReady, 250)
  let active = true
  return () => {
    if (!active) return
    active = false
    cancel(handle)
  }
}

function safeJSONValue(value: unknown, depth: number): boolean {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 4096 && value.every((entry) => safeJSONValue(entry, depth + 1))
  if (!isJSONObject(value)) return false
  return Object.entries(value).every(([key, entry]) => !['__proto__', 'prototype', 'constructor'].includes(key) && safeJSONValue(entry, depth + 1))
}

function isJSONObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
