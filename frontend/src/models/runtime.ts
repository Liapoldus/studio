import type { RuntimePluginReadiness } from '../api/types'

export function parsePluginReadiness(value: string): RuntimePluginReadiness {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return 'unknown' }
  if (!isRecord(parsed)) return 'unknown'
  const readiness = isRecord(parsed.readiness) ? parsed.readiness : undefined
  const identity = isRecord(parsed.identity) ? parsed.identity : undefined
  const ready = readiness?.ready ?? identity?.ready
  if (typeof ready !== 'boolean') return 'unknown'
  return ready ? 'ready' : 'not-ready'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
