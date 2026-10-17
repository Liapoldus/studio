import type { RuntimeService } from '../api/types'

const maximumDocumentLength = 262_144
const sha256Digest = /^sha256:[0-9a-f]{64}$/u

type JSONRecord = Record<string, unknown>

function record(value: unknown): JSONRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JSONRecord : null
}

function parseRecord(value: string): JSONRecord | null {
  if (value.length === 0 || value.length > maximumDocumentLength) return null
  try { return record(JSON.parse(value) as unknown) } catch { return null }
}

function runtimeRelease(statusJSON: string, serviceID: string): { replicaID: string; digest: string; version: string; replicas: string[] } | null {
  const status = parseRecord(statusJSON)
  if (!status || status.instanceId !== serviceID || typeof status.replicaId !== 'string' || status.replicaId.length === 0 ||
      status.artifactId !== serviceID || typeof status.artifactVersion !== 'string' ||
      typeof status.artifactDigest !== 'string' || !sha256Digest.test(status.artifactDigest)) return null
  if (!Array.isArray(status.replicas) || status.replicas.length === 0 || status.replicas.length > 4096) return null
  const replicas: string[] = []
  for (const value of status.replicas) {
    const replica = record(value)
    if (!replica || typeof replica.replicaId !== 'string' || replica.replicaId.length === 0 ||
        replica.artifactVersion !== status.artifactVersion || replica.artifactDigest !== status.artifactDigest ||
        typeof replica.artifactDigest !== 'string' || !sha256Digest.test(replica.artifactDigest)) return null
    replicas.push(replica.replicaId)
  }
  if (new Set(replicas).size !== replicas.length || !replicas.includes(status.replicaId)) return null
  replicas.sort()
  const identity = record(status.identity)
  const readiness = record(status.readiness)
  if (!identity || !readiness || identity.instanceId !== serviceID || identity.replicaId !== status.replicaId ||
      readiness.instanceId !== serviceID || readiness.replicaId !== status.replicaId) return null
  return { replicaID: status.replicaId, digest: status.artifactDigest, version: status.artifactVersion, replicas }
}

/**
 * Binds the live SDK documents to the immutable artifact reference selected in
 * the Project. Two Core status reads fence a runtime replacement during the
 * manifest/schema fetch; the Core status itself is derived from the
 * authenticated Service SDK registration, never from CLI-supplied display data.
 */
export function serviceConfigurationProvenanceDifferences(
  service: RuntimeService,
  manifestJSON: string,
  statusBeforeJSON: string,
  statusAfterJSON: string,
): string[] {
  const differences: string[] = []
  const artifact = service.artifact
  const manifest = parseRecord(manifestJSON)
  const before = runtimeRelease(statusBeforeJSON, service.id)
  const after = runtimeRelease(statusAfterJSON, service.id)

  if (!artifact || artifact.id !== service.id || typeof artifact.version !== 'string' || !sha256Digest.test(artifact.digest)) {
    differences.push('project.artifact')
  }
  if (!manifest || manifest.id !== service.id) differences.push('manifest.id')
  if (artifact && manifest && manifest.version !== artifact.version) differences.push('manifest.version')
  if (!before) differences.push('runtime.status.before')
  if (!after) differences.push('runtime.status.after')
  if (artifact && before && (before.digest !== artifact.digest || before.version !== artifact.version)) differences.push('runtime.artifact')
  if (before && after && (before.replicaID !== after.replicaID || before.digest !== after.digest || before.version !== after.version ||
      before.replicas.length !== after.replicas.length || before.replicas.some((id, index) => id !== after.replicas[index]))) {
    differences.push('runtime.changed_during_read')
  }
  return [...new Set(differences)].slice(0, 12)
}
