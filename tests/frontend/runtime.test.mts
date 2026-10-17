import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_RUNTIME_REPLICAS, groupRuntimeArtifacts, projectSettingsApplied, runtimeReplicasForService } from '../../frontend/src/models/runtime.ts'

await test('saved settings are applied only when every replica acknowledges the exact digest', () => {
  const replica = {
    replicaId: 'one', artifactVersion: '1', artifactDigest: `sha256:${'b'.repeat(64)}`,
    ready: true, generation: '2', pendingGeneration: '', schemaVersion: '1', desiredGeneration: 2,
    appliedGeneration: 2, configurationState: 'acknowledged' as const, lastFailureCode: '',
    configurationDigest: 'a'.repeat(64),
  }
  assert.equal(projectSettingsApplied(`sha256:${'a'.repeat(64)}`, [replica]), true)
  assert.equal(projectSettingsApplied('c'.repeat(64), [replica]), false)
  assert.equal(projectSettingsApplied('a'.repeat(64), []), false)
  assert.equal(projectSettingsApplied('a'.repeat(64), [replica, { ...replica, configurationDigest: 'c'.repeat(64) }]), false)
  assert.equal(projectSettingsApplied('a'.repeat(64), [{ ...replica, pendingGeneration: '3' }]), false)
})

await test('artifact registry display groups versions and puts the current project binding first without pruning', () => {
  const artifacts = [
    { id: 'echo', version: '1.2.1', platform: 'linux/arm64', digest: 'sha256:one', trusted: true },
    { id: 'server', version: '1.10.0', platform: 'linux/arm64', digest: 'sha256:two', trusted: true },
    { id: 'echo', version: '1.3.0', platform: 'linux/arm64', digest: 'sha256:three', trusted: false },
    { id: 'echo', version: '1.1.9', platform: 'linux/arm64', digest: 'sha256:four', trusted: true },
  ]
  const groups = groupRuntimeArtifacts(artifacts, [{ id: 'echo', artifact: { version: '1.2.1', platform: 'linux/arm64' } }])

  assert.deepEqual(groups.map((group) => group.service), ['echo', 'server'])
  assert.deepEqual(groups[0]?.entries.map((artifact) => artifact.version), ['1.2.1', '1.3.0', '1.1.9'])
  assert.deepEqual(groups[1]?.entries.map((artifact) => artifact.version), ['1.10.0'])
  assert.equal(artifacts.length, groups.reduce((count, group) => count + group.entries.length, 0))
})

await test('runtime replica selector returns a stable empty snapshot for missing service data', () => {
  const replicasByService = {}
  const firstWithoutSelection = runtimeReplicasForService(replicasByService, undefined)
  const secondWithoutSelection = runtimeReplicasForService(replicasByService, undefined)
  const firstMissingService = runtimeReplicasForService(replicasByService, 'server')
  const secondMissingService = runtimeReplicasForService(replicasByService, 'server')

  assert.strictEqual(firstWithoutSelection, EMPTY_RUNTIME_REPLICAS)
  assert.strictEqual(secondWithoutSelection, firstWithoutSelection)
  assert.strictEqual(firstMissingService, EMPTY_RUNTIME_REPLICAS)
  assert.strictEqual(secondMissingService, firstMissingService)
})

await test('runtime replica selector preserves the stored service snapshot', () => {
  const replicas = [{
    replicaId: 'replica-1', artifactVersion: '1.0.0', artifactDigest: `sha256:${'a'.repeat(64)}`,
    ready: true, generation: '1', pendingGeneration: '', schemaVersion: '1', desiredGeneration: null,
    appliedGeneration: null, configurationState: 'unconfigured' as const, lastFailureCode: '',
  }]
  const replicasByService = { server: replicas }

  assert.strictEqual(runtimeReplicasForService(replicasByService, 'server'), replicas)
})
