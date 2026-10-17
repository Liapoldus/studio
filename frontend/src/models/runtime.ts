import type { RuntimeReplicaStatus, RuntimeServiceReadiness } from '../api/types'

export interface ParsedServiceRuntimeStatus {
  readiness: RuntimeServiceReadiness
  replicas: RuntimeReplicaStatus[]
}

// Zustand selectors must return referentially stable snapshots when data is
// absent. A fresh [] here makes useSyncExternalStore observe a change on every
// read and can trigger React's maximum-update-depth error in the Inspector.
export const EMPTY_RUNTIME_REPLICAS: RuntimeReplicaStatus[] = []

export interface RuntimeArtifactEntry {
  id: string
  version: string
  platform: string
  digest: string
  trusted: boolean
}

export interface RuntimeArtifactGroup {
  service: string
  entries: RuntimeArtifactEntry[]
  bound?: { version: string; platform: string }
}

/** Group the CLI-owned artifact registry for a compact UI without pruning entries. */
export function groupRuntimeArtifacts(
  artifacts: readonly RuntimeArtifactEntry[],
  services: readonly { id: string; artifact?: { version: string; platform: string } }[],
): RuntimeArtifactGroup[] {
  const groups = new Map<string, RuntimeArtifactEntry[]>()
  for (const artifact of artifacts) {
    const entries = groups.get(artifact.id) ?? []
    entries.push(artifact)
    groups.set(artifact.id, entries)
  }
  const bindings = new Map(services.map((service) => [service.id, service.artifact]))
  const versionCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([service, entries]) => {
    const bound = bindings.get(service)
    const ordered = [...entries].sort((left, right) => {
      const leftBound = bound?.version === left.version && bound.platform === left.platform
      const rightBound = bound?.version === right.version && bound.platform === right.platform
      if (leftBound !== rightBound) return leftBound ? -1 : 1
      return versionCollator.compare(right.version, left.version) || left.platform.localeCompare(right.platform)
    })
    return { service, entries: ordered, bound }
  })
}

export function runtimeReplicasForService(
  replicasByService: Record<string, RuntimeReplicaStatus[]>,
  serviceID: string | undefined,
): RuntimeReplicaStatus[] {
  return serviceID ? replicasByService[serviceID] ?? EMPTY_RUNTIME_REPLICAS : EMPTY_RUNTIME_REPLICAS
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u

export function runtimeStopConfirmationText(target: string, locale: 'ru' | 'en'): string {
  return locale === 'ru'
    ? `Для target ${target} CLI остановит и удалит созданные runtime-контейнеры и временный staging. Файлы проекта, Core DB, credentials и исходные бинарники останутся без изменений.`
    : `For target ${target}, CLI will stop and remove its runtime containers and temporary staging. Project files, Core DB, credentials, and source binaries will remain unchanged.`
}

export function runtimeServiceActionConfirmationText(action: 'stop' | 'restart', serviceID: string, serviceName: string, target: string, locale: 'ru' | 'en'): string {
  if (locale === 'ru') {
    const verb = action === 'stop' ? 'остановит' : 'перезапустит'
    const effect = action === 'stop' ? 'Вызовы этого сервиса могут стать недоступны.' : 'Вызовы этого сервиса кратковременно станут недоступны.'
    return `Для target ${target} CLI ${verb} только выбранный сервис ${serviceName} (${serviceID}). ${effect} Project, Core и другие сервисы не изменятся.`
  }
  const verb = action === 'stop' ? 'stop' : 'restart'
  const effect = action === 'stop' ? 'Calls to this service may become unavailable.' : 'Calls to this service will briefly become unavailable.'
  return `For target ${target}, CLI will ${verb} only the selected service ${serviceName} (${serviceID}). ${effect} Project, Core, and other services will remain unchanged.`
}

export function parseServiceRuntimeStatus(value: string, serviceID: string): ParsedServiceRuntimeStatus | null {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!isRecord(parsed) || parsed.instanceId !== serviceID || !Array.isArray(parsed.replicas) || parsed.replicas.length === 0 || parsed.replicas.length > 4096) return null
  const ids = new Set<string>()
  const replicas: RuntimeReplicaStatus[] = []
  let release = ''
  let digest = ''
  for (const item of parsed.replicas) {
    if (!isRecord(item) || typeof item.replicaId !== 'string' || item.replicaId.length === 0 || ids.has(item.replicaId) ||
        typeof item.artifactVersion !== 'string' || item.artifactVersion.length === 0 || typeof item.artifactDigest !== 'string' || !digestPattern.test(item.artifactDigest) ||
        typeof item.ready !== 'boolean') return null
    const identity = isRecord(item.identity) ? item.identity : undefined
    const readiness = isRecord(item.readiness) ? item.readiness : undefined
    const configuration = isRecord(item.configuration) ? item.configuration : undefined
    if (!identity || identity.instanceId !== serviceID || identity.replicaId !== item.replicaId || !readiness ||
        readiness.instanceId !== serviceID || readiness.replicaId !== item.replicaId || readiness.ready !== item.ready ||
        typeof readiness.generation !== 'string' || typeof readiness.pendingGeneration !== 'string' || typeof readiness.schemaVersion !== 'string' ||
        !configuration || !validConfigurationStatus(configuration)) return null
    if (release && (release !== item.artifactVersion || digest !== item.artifactDigest)) return null
    release = item.artifactVersion
    digest = item.artifactDigest
    ids.add(item.replicaId)
    replicas.push({
      replicaId: item.replicaId, artifactVersion: item.artifactVersion, artifactDigest: item.artifactDigest,
      ready: item.ready, generation: readiness.generation, pendingGeneration: readiness.pendingGeneration,
      schemaVersion: readiness.schemaVersion,
      desiredGeneration: configuration.desiredGeneration as number | null,
      appliedGeneration: configuration.appliedGeneration as number | null,
      configurationState: configuration.state as RuntimeReplicaStatus['configurationState'],
      lastFailureCode: typeof configuration.lastFailureCode === 'string' ? configuration.lastFailureCode : '',
    })
  }
  const readyCount = replicas.filter((replica) => replica.ready && replica.pendingGeneration.length === 0 &&
    (replica.configurationState === 'unconfigured' || replica.configurationState === 'acknowledged')).length
  const firstGeneration = replicas[0]?.generation
  const firstSchemaVersion = replicas[0]?.schemaVersion
  const mixedEffectiveState = replicas.some((replica) => replica.generation !== firstGeneration || replica.schemaVersion !== firstSchemaVersion || replica.pendingGeneration.length > 0)
  const readiness: RuntimeServiceReadiness = readyCount === 0 ? 'not-ready' : readyCount !== replicas.length || mixedEffectiveState ? 'degraded' : 'ready'
  return { readiness, replicas }
}

function validConfigurationStatus(value: Record<string, unknown>): boolean {
  const states = ['unconfigured', 'unobserved', 'pending', 'acknowledged', 'stale', 'failed', 'unreachable'] as const
  if (!states.includes(value.state as typeof states[number])) return false
  const generation = (item: unknown) => item === null || Number.isSafeInteger(item) && (item as number) > 0
  if (!generation(value.desiredGeneration) || !generation(value.appliedGeneration) ||
      value.lastFailureCode !== undefined && (typeof value.lastFailureCode !== 'string' || value.lastFailureCode.length > 64 || !/^[A-Za-z0-9_.-]*$/u.test(value.lastFailureCode))) return false
  if (value.observedAt !== undefined && (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)))) return false
  if (value.state === 'unconfigured') return value.desiredGeneration === null && value.appliedGeneration === null
  if (value.desiredGeneration === null) return false
  if (value.state === 'acknowledged') return value.appliedGeneration === value.desiredGeneration && !value.lastFailureCode
  return true
}

export function parseServiceReadiness(value: string): RuntimeServiceReadiness {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return 'unknown' }
  if (!isRecord(parsed) || typeof parsed.instanceId !== 'string') return 'unknown'
  return parseServiceRuntimeStatus(value, parsed.instanceId)?.readiness ?? 'unknown'
}

/**
 * Reads only the Core-authenticated SDK health view. It deliberately does not
 * infer replica artifact provenance or configuration convergence; those remain
 * available only from the stricter service-status envelope above.
 */
export function parseCoreServiceReadiness(value: string, serviceID: string): RuntimeServiceReadiness {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return 'unknown' }
  if (!isRecord(parsed) || parsed.instanceId !== serviceID || !isRecord(parsed.identity) || !isRecord(parsed.readiness)) return 'unknown'
  const identity = parsed.identity
  const readiness = parsed.readiness
  if (identity.instanceId !== serviceID || typeof identity.replicaId !== 'string' || identity.replicaId.length === 0 ||
      readiness.instanceId !== serviceID || readiness.replicaId !== identity.replicaId || typeof readiness.ready !== 'boolean' ||
      typeof readiness.generation !== 'string' || typeof readiness.pendingGeneration !== 'string' || typeof readiness.schemaVersion !== 'string') return 'unknown'
  if (!readiness.ready) return 'not-ready'
  return readiness.pendingGeneration.length > 0 ? 'degraded' : 'ready'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
