import type { CoreSettingsView } from '../api/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid Core settings ${field}`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) throw new Error(`Invalid Core settings ${field}`)
  }
  return value
}

export function parseCoreSettingsView(encoded: string): CoreSettingsView {
  let decoded: unknown
  try { decoded = JSON.parse(encoded) as unknown } catch { throw new Error('Invalid Core settings JSON') }
  if (!isRecord(decoded) || decoded.schemaVersion !== 'core-settings-view/v1' || decoded.target !== 'local' ||
    typeof decoded.desiredRevision !== 'number' || !Number.isSafeInteger(decoded.desiredRevision) || decoded.desiredRevision < 1 ||
    typeof decoded.effectiveRevision !== 'number' || !Number.isSafeInteger(decoded.effectiveRevision) || decoded.effectiveRevision < 0 || decoded.effectiveRevision > decoded.desiredRevision ||
    typeof decoded.pending !== 'boolean' || typeof decoded.restartRequired !== 'boolean' || !isRecord(decoded.settings) || !isRecord(decoded.settings.management)) {
    throw new Error('Invalid redacted Core settings response')
  }
  const management = decoded.settings.management
  if (typeof management.maxBodyBytes !== 'number' || !Number.isSafeInteger(management.maxBodyBytes) || management.maxBodyBytes < 1 || management.maxBodyBytes > 16 * 1024 * 1024) {
    throw new Error('Invalid Core settings body limit')
  }
  return {
    schemaVersion: 'core-settings-view/v1',
    target: 'local',
    desiredRevision: decoded.desiredRevision,
    effectiveRevision: decoded.effectiveRevision,
    pending: decoded.pending,
    restartRequired: decoded.restartRequired,
    settings: {
      management: {
        listen: boundedText(management.listen, 'management.listen', 256),
        maxBodyBytes: management.maxBodyBytes,
        headerTimeout: boundedText(management.headerTimeout, 'management.headerTimeout', 64),
        requestTimeout: boundedText(management.requestTimeout, 'management.requestTimeout', 64),
      },
    },
  }
}
