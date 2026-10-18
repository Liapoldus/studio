import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { CLIEvent, RuntimeService, StudioAPI, Workspace, WorkspaceState } from '../../frontend/src/api/types.ts'
import { createStudioController } from '../../frontend/src/controllers/studioController.ts'
import { configurationArrayOperations, configurationArrayOperationsKey } from '../../frontend/src/models/configurationArray.ts'
import { configurationDraftKey, mergeConfiguration } from '../../frontend/src/models/configurationDraft.ts'
import { serviceConfigurationProvenanceDifferences } from '../../frontend/src/models/serviceConfigurationProvenance.ts'
import { workspaceStateWithApplyRecovery } from '../../frontend/src/models/studio.ts'
import { useStudioStore } from '../../frontend/src/stores/studio.ts'

beforeEach(() => { useStudioStore.setState({ applyRecoveryStatus: 'none', applyRecoveryOperationId: null, applyReviewPaths: [] }) })

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
function recoveryStateAPI(projectId: string) {
  let state: WorkspaceState = { projectId, layoutJson: '{}', tabsJson: JSON.stringify({ schemaVersion: 'workspace/v4', activeTabId: 'canvas', tabs: [], layout: {} }), filtersJson: '{}' }
  return {
    readWorkspaceState: () => Promise.resolve({ ...state }),
    writeWorkspaceState: (next: WorkspaceState) => { state = { ...next }; return Promise.resolve() },
    recoveryState: () => state,
    onCLIEvent: () => () => undefined,
  }
}
const artifactDigest = `sha256:${'a'.repeat(64)}`
function livePeerStatus(serviceID: string, version: string): string {
  const replicaID = `${serviceID}-replica`
  const identity = { instanceId: serviceID, replicaId: replicaID }
  return JSON.stringify({
    instanceId: serviceID, replicaId: replicaID, artifactId: serviceID,
    artifactVersion: version, artifactDigest,
    replicas: [{ replicaId: replicaID, artifactVersion: version, artifactDigest }],
    identity, readiness: { ...identity, ready: true },
  })
}
const liveMetadata = (schema: unknown, manifest: unknown = { version: '1.0.0' }) => (_projectID: string, serviceID: string, view: string) => {
  if (view === 'schema') return Promise.resolve(JSON.stringify(schema))
  if (view === 'status') return Promise.resolve(JSON.stringify({
    instanceId: serviceID, replicaId: 'replica-1', artifactId: serviceID, artifactVersion: '1.0.0', artifactDigest,
    identity: { instanceId: serviceID, replicaId: 'replica-1' }, readiness: { instanceId: serviceID, replicaId: 'replica-1', ready: true },
    replicas: [{ replicaId: 'replica-1', artifactVersion: '1.0.0', artifactDigest }],
  }))
  const value = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? { id: serviceID, version: '1.0.0', ...manifest }
    : manifest
  return Promise.resolve(JSON.stringify(value))
}
const service: RuntimeService = {
  id: 'server', name: 'Server', version: '1.0.0', manifestVersion: 'studio-runtime/v1',
  servicePath: 'services/server/service.yaml', settingsPath: 'services/server/settings.json',
  settingsSchemaPath: 'schemas/server-settings.json', configured: true, problemCount: 0, linkPaths: [],
  artifact: { id: 'server', version: '1.0.0', platform: 'linux/arm64', digest: artifactDigest },
}

await test('missing Project schema can be imported through Studio and Core-backed CLI', async () => {
  const projectID = 'schema-import-project'
  const rootPath = '/tmp/schema-import-project'
  const schema = { type: 'object', properties: { messagePrefix: { type: 'string', maxLength: 40 } } }
  const workspace = {
    project: { id: projectID, name: 'Schema import', rootPath },
    graph: { services: [service], links: [] },
    files: [],
  } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  let imported: string[] = []
  let schemaAvailable = false
  const api = {
    ...recoveryStateAPI(projectID),
    importServiceSettingsSchema: (requestedProject: string, serviceID: string) => {
      imported = [requestedProject, serviceID]
      schemaAvailable = true
      return Promise.resolve(workspace)
    },
    readProjectSchema: () => schemaAvailable ? Promise.resolve(bytes(schema)) : Promise.reject(new Error('schema is missing')),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ messagePrefix: 'echo: ' }), digest: 'sha256:settings' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  await controller.importServiceSettingsSchema(service)

  assert.deepEqual(imported, [projectID, 'server'])
  const key = configurationDraftKey(rootPath, 'server')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'matched')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.base, { messagePrefix: 'echo: ' })
})

await test('service artifact binding updates the shared Studio Project workspace', async () => {
  const workspace = {
    project: { id: 'artifact-binding', name: 'Artifact binding', rootPath: '/tmp/artifact-binding' },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  useStudioStore.setState({ workspace })
  let args: string[] = []
  const updated = {
    ...workspace,
    graph: { ...workspace.graph, services: [{ ...service, artifact: { id: 'server', version: '1.1.4', platform: 'linux/arm64', digest: `sha256:${'a'.repeat(64)}` } }] },
  } as unknown as Workspace
  const controller = createStudioController({
    bindRuntimeServiceArtifact: (projectID: string, serviceID: string, version: string, platform: string) => {
      args = [projectID, serviceID, version, platform]
      return Promise.resolve(updated)
    },
  } as unknown as StudioAPI)
  assert.equal(await controller.bindRuntimeServiceArtifact('server', '1.1.4', 'linux/arm64'), true)
  assert.deepEqual(args, ['artifact-binding', 'server', '1.1.4', 'linux/arm64'])
  assert.equal(useStudioStore.getState().workspace?.graph.services[0]?.artifact?.digest, `sha256:${'a'.repeat(64)}`)
})

await test('Studio plugin can save a locally validated Project draft while Core contract is unavailable', async () => {
  const projectID = 'offline-plugin-save'
  const rootPath = '/tmp/offline-plugin-save'
  const workspace = {
    project: { id: projectID, name: 'Offline plugin save', rootPath },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  const schema = { type: 'object', properties: { config: { type: 'object', properties: { routes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } } } }
  let written: unknown = null
  let applyCalls = 0
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ config: { routes: [] } }), digest: 'sha256:offline' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: () => Promise.reject(new Error('Core unavailable')),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: (_projectID: string, _serviceID: string, _digest: string, patch: Uint8Array) => {
      written = JSON.parse(new TextDecoder().decode(patch)) as unknown
      return Promise.resolve()
    },
    runStudioCommandAndWait: () => { applyCalls += 1; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  await controller.pluginReadServiceSettings(projectID, 'server')
  const key = configurationDraftKey(rootPath, 'server')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'unavailable')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['config', 'routes'], [{ id: 'echo-route' }])
  const pluginSave = await controller.pluginSaveServiceSettings(projectID, 'server')

  assert.deepEqual(written, { config: { routes: [{ id: 'echo-route' }] } })
  assert.equal(applyCalls, 0)
  assert.equal(pluginSave.applyState, 'review-required', 'adding a public route waits for the required Inspector review instead of claiming runtime application')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'clean')
})

await test('public bind changes are saved to Project and wait for explicit apply review', async () => {
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'settings-safe-fields', name: 'p', rootPath: '/tmp/settings-safe-fields' }, graph: { services: [service], links: [] } } as unknown as Workspace })
  let schemaReads = 0
  let settingsReads = 0
  let stored: Record<string, unknown> = { address: '127.0.0.1', password: 'operator-secret' }
  let digest = 'sha256:initial'
  let writtenPatch: unknown
  let applyIntent: string[] = []
  let persistedPatch: unknown
  let persistedProject = ''
  let deletedDraft = false
  const schema = { type: 'object', properties: { address: { type: 'string' }, password: { type: 'string', 'x-sensitive': true } } }
  const api = {
    ...recoveryStateAPI('settings-safe-fields'),
    readProjectSchema: () => { schemaReads += 1; return Promise.resolve(bytes(schema)) },
    readProjectSettings: () => { settingsReads += 1; return Promise.resolve({ valuesJson: JSON.stringify({ ...stored, password: null }), digest }) },
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: (projectID: string, _serviceID: string, _baseDigest: string, patchJson: string) => { persistedProject = projectID; persistedPatch = JSON.parse(patchJson) as unknown; return Promise.resolve() },
    deleteServiceSettingsDraft: () => { deletedDraft = true; return Promise.resolve() },
    writeProjectSettings: (_projectID: string, _serviceID: string, _expectedDigest: string, patchBytes: Uint8Array) => Promise.resolve().then(() => {
      const patch = JSON.parse(new TextDecoder().decode(patchBytes)) as Record<string, unknown>
      writtenPatch = patch
      stored = mergeConfiguration(stored, patch)
      digest = 'sha256:after-save'
    }),
    runStudioCommandAndWait: (command: string, target: string) => { applyIntent = [command, target]; return Promise.resolve() },
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey('/tmp/settings-safe-fields', service.id)

  assert.equal(await controller.loadServiceSettingsDraft(service), key)
  assert.equal(await controller.loadServiceSettingsDraft(service), key)
  assert.equal(schemaReads, 1)
  assert.equal(settingsReads, 1)
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.base, { address: '127.0.0.1', password: null })
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.baseDigest, 'sha256:initial')

  useStudioStore.getState().updateServiceSettingsDraft(key, ['address'], '0.0.0.0')
  await controller.persistServiceSettingsDraft(key)
  assert.equal(persistedProject, 'settings-safe-fields')
  assert.deepEqual(persistedPatch, { address: '0.0.0.0' })
  const pluginSave = await controller.pluginSaveServiceSettings('settings-safe-fields', 'server')
  assert.deepEqual(persistedPatch, { address: '0.0.0.0' })
  assert.deepEqual(writtenPatch, { address: '0.0.0.0' })
  assert.equal(pluginSave.applyState, 'review-required', 'the StudioPlugin must learn that public changes await Canvas Inspector review')
  assert.equal(JSON.stringify(writtenPatch).includes('operator-secret'), false)
  assert.equal(settingsReads, 2)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'clean')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.base, { address: '0.0.0.0', password: null })
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.baseDigest, 'sha256:after-save')
  assert.deepEqual(applyIntent, [], 'public bind changes require an explicit apply review')
  assert.ok(useStudioStore.getState().applyReviewPaths.some((path) => path.includes('address: replaced (value-redacted)')))
  await controller.applyServiceSettings(key)
  assert.deepEqual(applyIntent, ['dev.apply', 'local'])
  assert.equal(deletedDraft, true)
})

await test('undo and redo persist through the same project-scoped draft controller', async () => {
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'history-project', name: 'history-project', rootPath: '/tmp/history-project' }, graph: { services: [service], links: [] } } as unknown as Workspace })
  const persisted: Array<Record<string, unknown> | null> = []
  let projectWrites = 0
  const schema = { type: 'object', properties: { address: { type: 'string' } } }
  const api = {
    ...recoveryStateAPI('history-project'),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ address: '127.0.0.1' }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: (_projectID: string, _serviceID: string, _baseDigest: string, patchJson: string) => {
      persisted.push(JSON.parse(patchJson) as Record<string, unknown>)
      return Promise.resolve()
    },
    deleteServiceSettingsDraft: () => { persisted.push(null); return Promise.resolve() },
    writeProjectSettings: () => { projectWrites += 1; return Promise.resolve() },
    runStudioCommandAndWait: () => Promise.resolve(),
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey('/tmp/history-project', service.id)
  await controller.loadServiceSettingsDraft(service)
  useStudioStore.getState().updateServiceSettingsDraft(key, ['address'], '0.0.0.0')
  await controller.persistServiceSettingsDraft(key)
  await controller.undoServiceSettingsDraft(key)
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, {})
  assert.equal(persisted.at(-1), null, 'undo to the base removes the durable local patch')

  await controller.redoServiceSettingsDraft(key)
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, { address: '0.0.0.0' })
  assert.deepEqual(persisted.at(-1), { address: '0.0.0.0' })
  assert.equal(projectWrites, 0, 'history navigation itself does not bypass the normal save/apply action')
  await controller.discardServiceSettingsDraft(key, service)
})

await test('valid settings are saved and sent through dev.apply after the 800 ms idle window', async () => {
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'p-auto', name: 'p-auto', rootPath: '/tmp/p-auto' }, graph: { services: [service], links: [] } } as unknown as Workspace })
  let stored = { enabled: false }
  let writes = 0
  let applyCalls = 0
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const api = {
    ...recoveryStateAPI('p-auto'),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify(stored), digest: writes ? 'sha256:after' : 'sha256:before' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: (_projectID: string, _serviceID: string, _expectedDigest: string, patchBytes: Uint8Array) => {
      writes += 1
      stored = mergeConfiguration(stored, JSON.parse(new TextDecoder().decode(patchBytes)) as Record<string, unknown>) as typeof stored
      return Promise.resolve()
    },
    runStudioCommandAndWait: (command: string, target: string) => {
      assert.deepEqual([command, target], ['dev.apply', 'local'])
      applyCalls += 1
      return Promise.resolve()
    },
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey('/tmp/p-auto', service.id)
  await controller.loadServiceSettingsDraft({ ...service, settingsPath: 'services/server/settings.json' })
  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true)
  const changedAt = Date.now()
  await controller.persistServiceSettingsDraft(key)
  assert.equal(writes, 0)
  await new Promise((resolve) => { setTimeout(resolve, 500) })
  assert.equal(writes, 0)
  assert.equal(applyCalls, 0)
  await new Promise((resolve) => { setTimeout(resolve, Math.max(0, 1250 - (Date.now() - changedAt))) })
  assert.equal(writes, 1)
  assert.equal(applyCalls, 1)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'clean')
})

await test('automatic apply coalesces edits made while Core apply is in flight', async () => {
  const projectRoot = '/tmp/coalesced-auto-apply'
  const project = { id: 'coalesced-auto-apply', name: 'coalesced', rootPath: projectRoot }
  const secondService = { ...service, id: 'echo', name: 'Echo', artifact: { id: 'echo', version: '1.0.0', platform: 'linux/arm64', digest: artifactDigest }, settingsPath: 'services/echo/settings.json', settingsSchemaPath: 'schemas/echo-settings.json' }
  const workspace = { project, graph: { services: [service, secondService], links: [] }, files: [] } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const recovery = recoveryStateAPI(project.id)
  const stored: Record<string, { enabled: boolean }> = { server: { enabled: false }, echo: { enabled: false } }
  let writeCount = 0
  let applyCalls = 0
  let finishFirstApply!: () => void
  const firstApply = new Promise<void>((resolve) => { finishFirstApply = resolve })
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const api = {
    ...recovery,
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: (_projectID: string, serviceID: string) => Promise.resolve({ valuesJson: JSON.stringify(stored[serviceID]), digest: `sha256:${serviceID}:${String(writeCount)}` }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: (_projectID: string, serviceID: string, _expectedDigest: string, patchBytes: Uint8Array) => {
      writeCount += 1
      stored[serviceID] = mergeConfiguration(stored[serviceID], JSON.parse(new TextDecoder().decode(patchBytes)) as Record<string, unknown>) as { enabled: boolean }
      return Promise.resolve()
    },
    runStudioCommandAndWait: () => {
      applyCalls += 1
      return applyCalls === 1 ? firstApply : Promise.resolve()
    },
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, service.id)
  await controller.loadServiceSettingsDraft({ ...service, settingsPath: 'services/server/settings.json' })
  await controller.loadServiceSettingsDraft(secondService)

  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true)
  await controller.persistServiceSettingsDraft(key)
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 2_000
    const poll = () => {
      if (applyCalls === 1) resolve()
      else if (Date.now() >= deadline) reject(new Error('first automatic Core apply did not start'))
      else setTimeout(poll, 10)
    }
    poll()
  })

  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], false)
  await controller.persistServiceSettingsDraft(key)
  const secondKey = configurationDraftKey(projectRoot, secondService.id)
  useStudioStore.getState().updateServiceSettingsDraft(secondKey, ['enabled'], true)
  await controller.persistServiceSettingsDraft(secondKey)
  await new Promise((resolve) => { setTimeout(resolve, 900) })
  assert.equal(writeCount, 1, 'the later edit stays in the draft while the first apply is active')
  assert.equal(applyCalls, 1, 'queued cross-service changes must not apply concurrently')

  finishFirstApply()
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 2_000
    const poll = () => {
      if (applyCalls === 2 && writeCount === 3 && useStudioStore.getState().serviceSettingsDrafts[key]?.status === 'clean' && useStudioStore.getState().serviceSettingsDrafts[secondKey]?.status === 'clean') resolve()
      else if (Date.now() >= deadline) reject(new Error(`coalesced apply did not finish: writes=${String(writeCount)}, applies=${String(applyCalls)}`))
      else setTimeout(poll, 10)
    }
    poll()
  })
  assert.deepEqual(stored, { server: { enabled: false }, echo: { enabled: true } }, 'one queued apply must consume the latest drafts for all changed services')
})

await test('an apply failure pauses subsequent automatic applies until explicit retry', async () => {
  const projectRoot = '/tmp/pause-after-apply-failure'
  const project = { id: 'pause-after-apply-failure', name: 'pause', rootPath: projectRoot }
  const workspace = { project, graph: { services: [service], links: [] }, files: [] } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const recovery = recoveryStateAPI(project.id)
  let stored = { enabled: false }
  let writes = 0
  let applyCalls = 0
  let emitCLIEvent: ((event: CLIEvent) => void) | null = null
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const api = {
    ...recovery,
    openProject: () => Promise.resolve(workspace),
    listProjects: () => Promise.resolve([]),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify(stored), digest: `sha256:${String(writes)}` }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: (_projectID: string, _serviceID: string, _expectedDigest: string, patchBytes: Uint8Array) => {
      writes += 1
      stored = mergeConfiguration(stored, JSON.parse(new TextDecoder().decode(patchBytes)) as Record<string, unknown>) as typeof stored
      return Promise.resolve()
    },
    runStudioCommandAndWait: () => {
      applyCalls += 1
      if (applyCalls !== 1) return Promise.resolve()
      emitCLIEvent?.({ schemaVersion: 'cli-events/v1', type: 'operation.updated', target: 'local', operationId: 'operation-123', state: 'running' })
      return Promise.reject(new Error('Core unavailable'))
    },
    onCLIEvent: (callback: (event: CLIEvent) => void) => { emitCLIEvent = callback; return () => { emitCLIEvent = null } },
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, service.id)
  await controller.loadServiceSettingsDraft({ ...service, settingsPath: 'services/server/settings.json' })
  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true)
  await controller.persistServiceSettingsDraft(key)
  await new Promise((resolve) => { setTimeout(resolve, 1250) })
  assert.equal(writes, 1)
  assert.equal(applyCalls, 1)
  const failedRecovery = JSON.parse(recovery.recoveryState().tabsJson) as { applyRecovery: { state: string; operationId: string; schemaVersion: string; target: string } }
  assert.deepEqual(failedRecovery.applyRecovery, { schemaVersion: 'studio-apply-recovery/v3', state: 'confirmation-required', target: 'local', operationId: 'operation-123' })
  assert.equal(useStudioStore.getState().applyRecoveryOperationId, 'operation-123')

  useStudioStore.setState({ workspace: null, applyRecoveryStatus: 'none', serviceSettingsDrafts: {} })
  const reopened = createStudioController(api)
  await reopened.openProject(projectRoot)
  assert.equal(useStudioStore.getState().applyRecoveryStatus, 'confirmation-required')
  const reopenedKey = configurationDraftKey(projectRoot, service.id)
  assert.equal(useStudioStore.getState().applyRecoveryOperationId, 'operation-123', 'reopening preserves the Core operation identifier for reconciliation')
  await reopened.loadServiceSettingsDraft({ ...service, settingsPath: 'services/server/settings.json' })
  useStudioStore.getState().updateServiceSettingsDraft(reopenedKey, ['enabled'], false)
  await reopened.persistServiceSettingsDraft(reopenedKey)
  await new Promise((resolve) => { setTimeout(resolve, 1250) })
  assert.equal(writes, 2, 'valid settings still save locally while apply is paused')
  assert.equal(applyCalls, 1, 'a later edit must not silently retry a failed Core apply')

  await reopened.applyServiceSettings(reopenedKey)
  assert.equal(applyCalls, 2, 'the explicit Retry apply action resumes the paused scope')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[reopenedKey]?.status, 'clean')
  assert.equal(Object.hasOwn(JSON.parse(recovery.recoveryState().tabsJson) as object, 'applyRecovery'), false)
})

await test('recovery watches the persisted Core operation before clearing the ambiguous apply marker', async () => {
  const projectRoot = '/tmp/reconcile-core-operation'
  const project = { id: 'reconcile-core-operation', name: 'reconcile', rootPath: projectRoot }
  const workspace = { project, graph: { services: [], links: [] }, files: [] } as unknown as Workspace
  useStudioStore.setState({ workspace, applyRecoveryStatus: 'confirmation-required', applyRecoveryOperationId: 'operation-42', serviceSettingsDrafts: {} })
  const recovery = recoveryStateAPI(project.id)
  await recovery.writeWorkspaceState(workspaceStateWithApplyRecovery(recovery.recoveryState(), 'confirmation-required', 'operation-42'))
  let emitted: ((event: CLIEvent) => void) | null = null
  let intent: string[] = []
  const api = {
    ...recovery,
    workspace: () => Promise.resolve(workspace),
    runStudioCommandAndWait: (command: string, target: string, operationID: string) => {
      intent = [command, target, operationID]
      emitted?.({ schemaVersion: 'cli-events/v1', type: 'operation.updated', target: 'local', operationId: operationID, state: 'succeeded' })
      return Promise.resolve()
    },
    onCLIEvent: (callback: (event: CLIEvent) => void) => { emitted = callback; return () => { emitted = null } },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  await controller.reconcileApplyRecovery()

  assert.deepEqual(intent, ['operation.watch', 'local', 'operation-42'])
  assert.equal(useStudioStore.getState().applyRecoveryStatus, 'none')
  assert.equal(useStudioStore.getState().applyRecoveryOperationId, null)
  assert.equal(Object.hasOwn(JSON.parse(recovery.recoveryState().tabsJson) as object, 'applyRecovery'), false)
})

await test('explicit failed-apply recovery uses the typed retry CLI intent', async () => {
  const projectRoot = '/tmp/explicit-failed-apply-retry'
  const project = { id: 'explicit-failed-apply-retry', name: 'retry', rootPath: projectRoot }
  const workspace = { project, graph: { services: [service], links: [] }, files: [] } as unknown as Workspace
  useStudioStore.setState({ workspace, applyRecoveryStatus: 'confirmation-required', applyRecoveryOperationId: null, serviceSettingsDrafts: {} })
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  let intent: string[] = []
  const api = {
    ...recoveryStateAPI(project.id),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ enabled: true }), digest: 'sha256:retry-base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: liveMetadata(schema),
    runStudioCommandAndWait: (command: string, target: string) => { intent = [command, target]; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  await controller.loadServiceSettingsDraft(service)
  const key = configurationDraftKey(projectRoot, service.id)

  await controller.retryFailedServiceSettings(key)

  assert.deepEqual(intent, ['dev.apply.retryFailed', 'local'])
  assert.equal(useStudioStore.getState().applyRecoveryStatus, 'none')
})

await test('a queued settings save never applies against a different active Project', async () => {
  const originalRoot = '/tmp/project-before-switch'
  const otherWorkspace = { project: { id: 'other-project', name: 'other', rootPath: '/tmp/other-project' } } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'original-project', name: 'original', rootPath: originalRoot }, graph: { services: [service], links: [] } } as unknown as Workspace })
  let stored = { enabled: false }
  let applyCalls = 0
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const api = {
    ...recoveryStateAPI('original-project'),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify(stored), digest: 'sha256:after-write' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: (_projectID: string, _serviceID: string, _expectedDigest: string, patchBytes: Uint8Array) => {
      stored = mergeConfiguration(stored, JSON.parse(new TextDecoder().decode(patchBytes)) as Record<string, unknown>) as typeof stored
      useStudioStore.setState({ workspace: otherWorkspace })
      return Promise.resolve()
    },
    runStudioCommandAndWait: () => { applyCalls += 1; return Promise.resolve() },
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(originalRoot, service.id)
  await controller.loadServiceSettingsDraft({ ...service, settingsPath: 'services/server/settings.json' })
  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true)

  await controller.saveServiceSettingsDraft(key)

  assert.deepEqual(stored, { enabled: true }, 'the original Project save still completes')
  assert.equal(applyCalls, 0, 'the CLI must not apply whichever Project became active during the save')
  assert.match(useStudioStore.getState().error ?? '', /workspace changed/u)
  assert.equal(useStudioStore.getState().workspace?.project?.id, 'other-project')
})

await test('failed settings save preserves the patch for retry', async () => {
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'p', name: 'p', rootPath: '/tmp/failure' }, graph: { services: [service], links: [] } } as unknown as Workspace })
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const api = {
    ...recoveryStateAPI('p'),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ enabled: false }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: () => Promise.reject(new Error('schema validation failed')),
    runStudioCommandAndWait: () => { throw new Error('must not apply an unsaved project') },
    readRuntimeServiceMetadata: liveMetadata(schema),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey('/tmp/failure', service.id)
  await controller.loadServiceSettingsDraft({ ...service, settingsPath: 'services/server/settings.json' })
  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true)

  await controller.saveServiceSettingsDraft(key)
  const draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.equal(draft?.status, 'error')
  assert.equal(draft.error, 'schema validation failed')
  assert.deepEqual(draft.patch, { enabled: true })
})

await test('persisted draft is restored but becomes a conflict when Project changed', async () => {
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'p', name: 'p', rootPath: '/tmp/conflict' }, graph: { services: [service], links: [] } } as unknown as Workspace })
  let deleted = false
  const api = {
    readProjectSchema: () => Promise.resolve(bytes({ type: 'object', properties: { address: { type: 'string' } } })),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ address: 'current' }), digest: 'sha256:current' }),
    readServiceSettingsDraft: () => Promise.resolve({
      serviceId: 'server', settingsPath: service.settingsPath, schemaPath: service.settingsSchemaPath,
      baseDigest: 'sha256:old', patchJson: JSON.stringify({ address: 'draft-value' }),
    }),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => { deleted = true; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey('/tmp/conflict', service.id)
  await controller.loadServiceSettingsDraft(service)
  const draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.equal(draft?.status, 'conflict')
  assert.deepEqual(draft.patch, { address: 'draft-value' })
  assert.deepEqual(draft.base, { address: 'current' })
  await controller.discardServiceSettingsDraft(key)
  assert.equal(deleted, true)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'clean')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, {})
})

await test('live schema mismatch pauses edits and apply, and contract refresh preserves the draft', async () => {
  const projectID = 'schema-drift-project'
  const projectRoot = '/tmp/schema-drift-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service] },
  } as Workspace })
  let projectSchema: Record<string, unknown> = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } }
  const liveSchema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65534 } } }
  let persistedPatch = { port: 8080 }
  let settings = { port: 8000 }
  let applied = 0
  let resolvePersist: (() => void) | undefined
  let deferPersist = true
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(projectSchema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify(settings), digest: 'sha256:settings' }),
    readServiceSettingsDraft: () => Promise.resolve({
      serviceId: 'server', settingsPath: service.settingsPath, schemaPath: service.settingsSchemaPath,
      baseDigest: 'sha256:settings', patchJson: JSON.stringify(persistedPatch),
    }),
    saveServiceSettingsDraft: (_projectID: string, _serviceID: string, _base: string, patchJSON: string) => {
      persistedPatch = JSON.parse(patchJSON) as typeof persistedPatch
      if (!deferPersist) return Promise.resolve()
      deferPersist = false
      return new Promise<void>((resolve) => { resolvePersist = resolve })
    },
    deleteServiceSettingsDraft: () => Promise.resolve(),
    readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => view === 'status'
      ? liveMetadata(liveSchema)(_projectID, serviceID, view)
      : Promise.resolve(JSON.stringify(view === 'schema' ? liveSchema : { id: 'server', version: '1.0.0' })),
    writeProjectSettings: (_projectID: string, _serviceID: string, _digest: string, patchBytes: Uint8Array) => {
      settings = { ...settings, ...JSON.parse(new TextDecoder().decode(patchBytes)) as typeof settings }
      return Promise.resolve()
    },
    runStudioCommandAndWait: () => { applied++; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, 'server')
  await controller.loadServiceSettingsDraft(service)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'mismatch')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractMismatchKind, 'schema')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, { port: 8080 })
  assert.throws(() => { useStudioStore.getState().updateServiceSettingsDraft(key, ['port'], 9000) }, /Live service schema differs/u)
  await assert.rejects(controller.pluginPatchServiceSettings(projectID, 'server', ['port'], 9000), /bridge\.schema_mismatch/u)
  await assert.rejects(controller.applyServiceSettings(key), /Live service schema differs/u)
  assert.equal(applied, 0)

  projectSchema = liveSchema
  const refresh = controller.refreshServiceSettingsContract(service)
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.refreshingContract, true)
  useStudioStore.getState().updateServiceSettingsDraft(key, ['port'], 9000)
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, { port: 8080 })
  resolvePersist?.()
  await refresh
  const refreshed = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(refreshed)
  assert.equal(refreshed.configurationContractState, 'matched')
  assert.deepEqual(refreshed.patch, { port: 8080 })
  await controller.saveServiceSettingsDraft(key)
  assert.deepEqual(settings, { port: 8080 })
  assert.equal(applied, 1)
})

await test('Studio plugin receives provenance mismatch separately from schema mismatch', async () => {
  const projectID = 'provenance-mismatch-project'
  const rootPath = '/tmp/provenance-mismatch-project'
  const schema = { type: 'object', properties: { port: { type: 'integer' } } }
  const workspace = {
    project: { id: projectID, name: 'Provenance mismatch', rootPath },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ port: 8080 }), digest: 'sha256:provenance' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: (_requestedProject: string, serviceID: string, view: string) => Promise.resolve(JSON.stringify(
      view === 'schema' ? schema : view === 'status'
        ? { instanceId: serviceID, replicaId: 'replica-1', identity: { instanceId: serviceID, replicaId: 'replica-1' }, readiness: { instanceId: serviceID, replicaId: 'replica-1', ready: true } }
        : { id: serviceID, version: '1.0.0' },
    )),
    runStudioCommandAndWait: (command: string, target: string) => {
      assert.equal(command, 'core.start')
      assert.equal(target, 'local')
      return Promise.resolve()
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(rootPath, service.id)

  await controller.pluginReadServiceSettings(projectID, service.id)

  const draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.configurationContractState, 'mismatch')
  assert.equal(draft.configurationContractMismatchKind, 'provenance')
  await assert.rejects(controller.pluginPatchServiceSettings(projectID, service.id, ['port'], 9000), /bridge\.provenance_mismatch/u)
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, {})
})

await test('endpoint edits reject a provenance mismatch without implicitly starting Core', async () => {
  const projectID = 'provenance-auto-update-project'
  const rootPath = '/tmp/provenance-auto-update-project'
  const schema = { type: 'object', properties: { port: { type: 'integer' } } }
  const workspace = {
    project: { id: projectID, name: 'Provenance auto update', rootPath },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  let startCalls = 0
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ port: 8080 }), digest: 'sha256:auto-update' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    readRuntimeServiceMetadata: (_requestedProject: string, serviceID: string, view: string) => {
      if (view === 'schema') return Promise.resolve(JSON.stringify(schema))
      if (view === 'manifest') return Promise.resolve(JSON.stringify({ id: serviceID, version: '1.0.0' }))
      const status = { instanceId: serviceID, replicaId: 'replica-1', identity: { instanceId: serviceID, replicaId: 'replica-1' },
        readiness: { instanceId: serviceID, replicaId: 'replica-1', ready: true } }
      return Promise.resolve(JSON.stringify(status))
    },
    runStudioCommandAndWait: (command: string, target: string) => {
      assert.equal(command, 'core.start')
      assert.equal(target, 'local')
      startCalls += 1
      return Promise.resolve()
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(rootPath, service.id)

  await controller.pluginReadServiceSettings(projectID, service.id)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractMismatchKind, 'provenance')
  await assert.rejects(
    controller.pluginPatchServiceSettings(projectID, service.id, ['port'], 9000),
    /bridge\.provenance_mismatch/u,
  )

  assert.equal(startCalls, 0)
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, {})
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'mismatch')
})

await test('schema preview is Core-fenced, read-only to Project values, and bound to the current draft', async () => {
  const projectID = 'schema-preview-contract'
  const rootPath = '/tmp/schema-preview-contract'
  const projectSchema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } }
  const liveSchema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 7000 } } }
  const workspace = { project: { id: projectID, name: 'Schema preview', rootPath }, graph: { services: [service], links: [] } } as unknown as Workspace
  const storedSettings = { port: 8080 }
  const storedDraft = { port: 9000 }
  let previewPatch = ''
  let settingsWritten = false
  let previewObservedLockedDraft = false
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(projectSchema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify(storedSettings), digest: `sha256:${'b'.repeat(64)}` }),
    readServiceSettingsDraft: () => Promise.resolve({
      serviceId: service.id, settingsPath: service.settingsPath, schemaPath: service.settingsSchemaPath,
      baseDigest: `sha256:${'b'.repeat(64)}`, patchJson: JSON.stringify(storedDraft),
    }),
    readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => liveMetadata(liveSchema)(_projectID, serviceID, view),
    saveServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: () => { settingsWritten = true; return Promise.resolve() },
    previewServiceSettingsSchema: (_projectID: string, _serviceID: string, patchJSON: string) => {
      previewPatch = patchJSON
      previewObservedLockedDraft = Boolean(useStudioStore.getState().serviceSettingsDrafts[configurationDraftKey(rootPath, service.id)]?.refreshingContract)
      return Promise.resolve({
        schemaJson: JSON.stringify(liveSchema), schemaDigest: `sha256:${'a'.repeat(64)}`,
        previousSchemaDigest: `sha256:${'d'.repeat(64)}`,
        settingsDigest: `sha256:${'b'.repeat(64)}`, draftDigest: `sha256:${'c'.repeat(64)}`,
        migrationRequired: false, migrationFromVersion: 0, migrationToVersion: 0,
        migrationCandidateDigest: '', migrationChangedPaths: [], recoveryCopyPath: '', recoverySchemaCopyPath: '',
        valuesCompatible: false,
      })
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const preview = await controller.previewServiceSettingsSchema(service)
  const key = configurationDraftKey(rootPath, service.id)

  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractMismatchKind, 'schema')
  assert.deepEqual(JSON.parse(previewPatch) as unknown, storedDraft)
  assert.equal(previewObservedLockedDraft, true)
  assert.equal(preview.valuesCompatible, false)
  assert.equal(JSON.stringify(preview).includes('8080'), false)
  assert.equal(JSON.stringify(preview).includes('9000'), false)
  assert.equal(settingsWritten, false)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.refreshingContract, false)
})

await test('offline Project drafts remain saveable locally but cannot claim a Core apply', async () => {
  const projectRoot = '/tmp/offline-schema-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'offline-schema-project', name: 'offline', rootPath: projectRoot }, graph: { services: [service], links: [] } } as unknown as Workspace })
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  let saved = false
  let applyCalls = 0
  const api = {
    ...recoveryStateAPI('offline-schema-project'),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ enabled: false }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: () => { saved = true; return Promise.resolve() },
    readRuntimeServiceMetadata: () => Promise.reject(new Error('Core unavailable')),
    runStudioCommandAndWait: () => { applyCalls++; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, service.id)
  await controller.loadServiceSettingsDraft(service)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'unavailable')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true)
  await controller.saveServiceSettingsDraft(key)
  assert.equal(saved, true)
  assert.equal(applyCalls, 0)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'clean')
  await assert.rejects(controller.applyServiceSettings(key), /not been verified through Core/u)
  assert.equal(applyCalls, 0)
})

await test('schema refresh flushes a pending settings draft before reloading it', async () => {
  const projectID = 'schema-refresh-draft'
  const projectRoot = '/tmp/schema-refresh-draft'
  const workspace = {
    project: { id: projectID, name: 'Schema refresh', rootPath: projectRoot },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  const schema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } }
  const liveSchema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65534 } } }
  let persistedPatch: Record<string, unknown> | null = null
  let patchAtRefresh: Record<string, unknown> | null = null
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ port: 8000 }), digest: 'sha256:settings' }),
    readServiceSettingsDraft: () => Promise.resolve(persistedPatch ? {
      serviceId: 'server', settingsPath: service.settingsPath, schemaPath: service.settingsSchemaPath,
      baseDigest: 'sha256:settings', patchJson: JSON.stringify(persistedPatch),
    } : null),
    saveServiceSettingsDraft: (_projectID: string, _serviceID: string, _base: string, patchJSON: string) => {
      persistedPatch = JSON.parse(patchJSON) as Record<string, unknown>
      return Promise.resolve()
    },
    deleteServiceSettingsDraft: () => { persistedPatch = null; return Promise.resolve() },
    readRuntimeServiceMetadata: liveMetadata(schema),
    refreshServiceSettingsSchema: () => {
      patchAtRefresh = persistedPatch ? { ...persistedPatch } : null
      return Promise.resolve(workspace)
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, service.id)
  await controller.loadServiceSettingsDraft(service)
  useStudioStore.getState().updateServiceSettingsDraft(key, ['port'], 9000)
  // A live schema change can arrive while a previously accepted edit is
  // waiting in the persistence debounce. The UI must freeze further edits,
  // but schema refresh must flush this already-created safe draft first.
  useStudioStore.setState((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft) throw new Error('expected loaded settings draft')
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: {
      ...draft, configurationContractState: 'mismatch', configurationContractMismatchKind: 'schema',
    } } }
  })

  const pendingPersist = controller.persistServiceSettingsDraft(key)
  await controller.refreshServiceSettingsSchema(service, {
    schemaJson: JSON.stringify(liveSchema), schemaDigest: `sha256:${'a'.repeat(64)}`,
    previousSchemaDigest: `sha256:${'d'.repeat(64)}`,
    settingsDigest: `sha256:${'e'.repeat(64)}`, draftDigest: `sha256:${'b'.repeat(64)}`,
    migrationRequired: false, migrationFromVersion: 0, migrationToVersion: 0,
    migrationCandidateDigest: '', migrationChangedPaths: [], recoveryCopyPath: '', recoverySchemaCopyPath: '', valuesCompatible: true,
  })
  await pendingPersist

  assert.deepEqual(patchAtRefresh, { port: 9000 })
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, { port: 9000 })
})

await test('inspector consumes the Core-backed SDK UI descriptor with an explicit project scope', async () => {
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: { project: { id: 'project-a', name: 'a', rootPath: '/tmp/project-a' }, graph: { services: [service], links: [] } } as unknown as Workspace })
  const metadataScopes: string[][] = []
  const schema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } }
  const manifest = {
    id: 'server',
    configurationUI: {
      version: 'service-configuration-ui/v1',
      groups: [{ id: 'listener', title: { ru: 'Слушатель', en: 'Listener' }, fields: [{ path: '/port', label: { ru: 'Порт', en: 'Port' }, widget: 'slider' }] }],
    },
  }
  const api = {
    ...recoveryStateAPI('project-a'),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ port: 8080 }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: (projectID: string, serviceID: string, view: string) => {
      metadataScopes.push([projectID, serviceID, view])
      return view === 'status'
        ? liveMetadata(schema)(projectID, serviceID, view)
        : Promise.resolve(JSON.stringify(view === 'schema' ? schema : { ...manifest, id: serviceID, version: '1.0.0' }))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey('/tmp/project-a', 'server')
  await controller.loadServiceSettingsDraft(service)
  assert.deepEqual(metadataScopes, [
    ['project-a', 'server', 'status'], ['project-a', 'server', 'manifest'],
    ['project-a', 'server', 'schema'], ['project-a', 'server', 'status'],
  ])
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'matched')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationUI?.groups[0]?.title.en, 'Listener')
})

await test('live configuration contract is fenced by authenticated replica artifact provenance', async () => {
  const projectID = 'provenance-project'
  const projectRoot = '/tmp/provenance-project'
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const status = (digest: string, replicaID = 'replica-1', replicaIDs = [replicaID]) => JSON.stringify({
    instanceId: 'server', replicaId: replicaID, artifactId: 'server', artifactVersion: '1.0.0', artifactDigest: digest,
    identity: { instanceId: 'server', replicaId: replicaID }, readiness: { instanceId: 'server', replicaId: replicaID, ready: true },
    replicas: replicaIDs.map((id) => ({ replicaId: id, artifactVersion: '1.0.0', artifactDigest: digest })),
  })
  assert.deepEqual(serviceConfigurationProvenanceDifferences(service, JSON.stringify({ id: 'server', version: '1.0.0' }), status(artifactDigest), status(artifactDigest)), [])
  assert.deepEqual(serviceConfigurationProvenanceDifferences(service, JSON.stringify({ id: 'server', version: '1.0.0' }), status(artifactDigest, 'replica-1', ['replica-1', 'replica-2']), status(artifactDigest, 'replica-1', ['replica-1', 'replica-2'])), [])
  assert.ok(serviceConfigurationProvenanceDifferences(service, JSON.stringify({ id: 'server', version: '1.0.0' }), status(`sha256:${'b'.repeat(64)}`), status(`sha256:${'b'.repeat(64)}`)).includes('runtime.artifact'))
  assert.ok(serviceConfigurationProvenanceDifferences(service, JSON.stringify({ id: 'server', version: '1.0.0' }), status(artifactDigest), status(`sha256:${'b'.repeat(64)}`)).includes('runtime.changed_during_read'))
  assert.ok(serviceConfigurationProvenanceDifferences(service, JSON.stringify({ id: 'server', version: '1.0.0' }), status(artifactDigest, 'replica-1', ['replica-1']), status(artifactDigest, 'replica-1', ['replica-1', 'replica-2'])).includes('runtime.changed_during_read'))
  assert.ok(serviceConfigurationProvenanceDifferences(service, JSON.stringify({ id: 'server', version: '1.0.0' }), JSON.stringify({ ...JSON.parse(status(artifactDigest)) as Record<string, unknown>, replicas: [{ replicaId: 'replica-1', artifactVersion: '1.0.0', artifactDigest }, { replicaId: 'replica-2', artifactVersion: '1.0.0', artifactDigest: `sha256:${'b'.repeat(64)}` }] }), status(artifactDigest)).includes('runtime.status.before'))

  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ enabled: false }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: (_projectID: string, _serviceID: string, view: string) => Promise.resolve(
      view === 'schema' ? JSON.stringify(schema) : view === 'manifest' ? JSON.stringify({ id: 'server', version: '1.0.0' }) : status(`sha256:${'b'.repeat(64)}`),
    ),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, 'server')
  await controller.loadServiceSettingsDraft(service)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'mismatch')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractMismatchKind, 'provenance')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractDifferences, ['runtime.artifact'])
  await assert.rejects(controller.applyServiceSettings(key), /Live service schema differs/u)
})

await test('open service draft revalidates automatically when runtime artifact provenance changes', async () => {
  const projectID = 'runtime-release-poll'
  const projectRoot = '/tmp/runtime-release-poll'
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  let runtimeDigest = artifactDigest
  let manifestReads = 0
  const status = (digest: string) => JSON.stringify({
    instanceId: service.id, replicaId: 'replica-1', artifactId: service.id, artifactVersion: '1.0.0', artifactDigest: digest,
    identity: { instanceId: service.id, replicaId: 'replica-1' },
    readiness: { instanceId: service.id, replicaId: 'replica-1', ready: true },
    replicas: [{
    replicaId: 'replica-1', artifactVersion: '1.0.0', artifactDigest: digest, ready: true,
    identity: { instanceId: service.id, replicaId: 'replica-1' },
    readiness: { instanceId: service.id, replicaId: 'replica-1', ready: true, generation: 'g1', pendingGeneration: '', schemaVersion: 'v1' },
    configuration: { state: 'unconfigured', desiredGeneration: null, appliedGeneration: null },
  }] })
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ enabled: false }), digest: 'sha256:runtime-poll' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    readRuntimeServiceMetadata: (_requestedProject: string, _serviceID: string, view: string) => {
      if (view === 'status') return Promise.resolve(status(runtimeDigest))
      if (view === 'manifest') { manifestReads += 1; return Promise.resolve(JSON.stringify({ id: service.id, version: '1.0.0' })) }
      return Promise.resolve(JSON.stringify(schema))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const key = configurationDraftKey(projectRoot, service.id)

  await controller.loadServiceSettingsDraft(service)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'matched')

  runtimeDigest = `sha256:${'b'.repeat(64)}`
  await controller.refreshRuntimeStatuses()
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'mismatch')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractMismatchKind, 'provenance')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractDifferences, ['runtime.artifact'])
  assert.equal(manifestReads, 1, 'a release mismatch must pause the draft without trusting or reloading its manifest')
  assert.throws(() => { useStudioStore.getState().updateServiceSettingsDraft(key, ['enabled'], true) }, /Live service schema differs/u)

  runtimeDigest = artifactDigest
  await controller.refreshRuntimeStatuses()
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.configurationContractState, 'matched')
  assert.equal(manifestReads, 2, 'recovery must fetch the live manifest and schema again')
})

await test('StudioPlugin configuration UI read waits for Core-backed metadata', async () => {
  const projectID = 'descriptor-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: 'project', rootPath: '/tmp/descriptor-project' },
    graph: { services: [service] },
  } as Workspace })
  const schema = { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } }
  const manifest = JSON.stringify({ id: 'server', version: '1.0.0', configurationUI: {
    version: 'service-configuration-ui/v1',
    groups: [{ id: 'listener', title: { ru: 'Слушатель', en: 'Listener' }, fields: [
      { path: '/port', label: { ru: 'Порт', en: 'Port' }, widget: 'slider' },
    ] }],
  } })
  let resolveMetadata: ((value: string) => void) | undefined
  let metadataRequested = false
  const metadataViews: string[] = []
  const metadata = new Promise<string>((resolve) => { resolveMetadata = resolve })
  const api = {
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ port: 8080 }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: (requestedProject: string, serviceID: string, view: string) => {
      assert.deepEqual([requestedProject, serviceID], [projectID, 'server'])
      metadataViews.push(view)
      metadataRequested = true
      if (view === 'status') return liveMetadata(schema)(requestedProject, serviceID, view)
      return view === 'manifest' ? metadata : Promise.resolve(JSON.stringify(schema))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  let settled = false
  const read = controller.pluginReadServiceConfigurationUI(projectID, 'server').then((value) => { settled = true; return value })
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  assert.equal(metadataRequested, true)
  assert.equal(settled, false)

  resolveMetadata?.(manifest)
  const result = await read
  assert.ok(result)
  assert.equal(result.groups[0]?.fields[0]?.widget, 'slider')
  assert.equal(result.groups[0]?.fields[0]?.label.ru, 'Порт')
  assert.deepEqual(metadataViews, ['status', 'manifest', 'schema', 'status'])
})

await test('StudioPlugin resource bridge returns only bounded catalog value and label fields', async () => {
  const projectID = 'resource-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/resource-project' },
    graph: { services: [service] },
  } as Workspace })
  const api = {
    readRuntimeServiceResource: (requestedProject: string, serviceID: string, resourceID: string) => {
      assert.deepEqual([requestedProject, serviceID, resourceID], [projectID, 'server', 'sites'])
      return Promise.resolve(JSON.stringify({ resourceId: 'sites', items: [{ value: 'docs', label: 'docs', privateKey: 'must-not-cross-host' }] }))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  assert.deepEqual(await controller.pluginReadServiceResource(projectID, 'server', 'sites'), { items: [{ value: 'docs', label: 'docs' }] })
  await assert.rejects(controller.pluginReadServiceResource(projectID, 'server', '../sites'), /bridge.invalid_resource/u)
})

await test('StudioPlugin Admin Surface bridge is Core-backed, project-scoped and digest-checked', async () => {
  const projectID = 'admin-surface-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/admin-surface-project' },
    graph: { services: [service] },
  } as Workspace })
  const api = {
    readRuntimeServiceAdminSurface: (requestedProject: string, serviceID: string) => {
      assert.deepEqual([requestedProject, serviceID], [projectID, 'server'])
      return Promise.resolve(JSON.stringify({ serviceId: 'server', digest: artifactDigest, descriptor: { pages: [] } }))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  assert.deepEqual(await controller.pluginReadServiceAdminSurface(projectID, 'server'), {
    serviceId: 'server', digest: artifactDigest, descriptor: { pages: [] },
  })
  await assert.rejects(controller.pluginReadServiceAdminSurface('other-project', 'server'), /bridge.context_changed/u)

  const invalidDigestAPI = { readRuntimeServiceAdminSurface: () => Promise.resolve(JSON.stringify({ serviceId: 'server', digest: 'sha256:sha256:bad', descriptor: {} })) } as unknown as StudioAPI
  await assert.rejects(createStudioController(invalidDigestAPI).pluginReadServiceAdminSurface(projectID, 'server'), /bridge.admin_surface_digest_invalid/u)

  const invalidResponseAPI = { readRuntimeServiceAdminSurface: () => Promise.resolve(JSON.stringify({ serviceId: 'echo', digest: artifactDigest, descriptor: {} })) } as unknown as StudioAPI
  await assert.rejects(createStudioController(invalidResponseAPI).pluginReadServiceAdminSurface(projectID, 'server'), /bridge.admin_surface_response_invalid/u)
})

await test('StudioPlugin Admin Surface table and actions stay typed and service-scoped', async () => {
  const projectID = 'admin-actions-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/admin-actions-project' },
    graph: { services: [service] },
  } as Workspace })
  const calls: unknown[][] = []
  const api = {
    readRuntimeServiceAdminTable: (...args: unknown[]) => {
      calls.push(['query', ...args])
      return Promise.resolve(JSON.stringify({ items: [{ siteId: 'docs' }], nextCursor: null }))
    },
    invokeRuntimeServiceAdminAction: (...args: unknown[]) => {
      calls.push(['action', ...args])
      return Promise.resolve(JSON.stringify({ completed: true }))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  assert.deepEqual(await controller.pluginReadServiceAdminTable(projectID, 'server', 'sites', 'sites', artifactDigest, 'cursor-1'), {
    items: [{ siteId: 'docs' }], nextCursor: null,
  })
  assert.deepEqual(await controller.pluginInvokeServiceAdminAction(projectID, 'server', {
    pageId: 'sites', sectionId: 'sites', actionId: 'rollback',
    input: { siteId: 'docs', expectedCurrentRevision: 'r-2', targetRevision: 'r-1' },
    surfaceDigest: artifactDigest, ifMatch: 'r-2',
  }), { completed: true })
  assert.deepEqual(calls, [
    ['query', projectID, 'server', 'sites', 'sites', artifactDigest, 'cursor-1'],
    ['action', projectID, 'server', 'sites', 'sites', 'rollback', JSON.stringify({ siteId: 'docs', expectedCurrentRevision: 'r-2', targetRevision: 'r-1' }), 'r-2', artifactDigest],
  ])
  await assert.rejects(controller.pluginInvokeServiceAdminAction(projectID, 'server', {
    pageId: 'sites', sectionId: 'sites', actionId: 'rollback', input: { apiToken: 'never' }, surfaceDigest: artifactDigest,
  }), /bridge.admin_action_input_invalid/u)
  await assert.rejects(controller.pluginReadServiceAdminTable(projectID, 'server', 'sites', 'sites', 'invalid-digest'), /bridge.admin_surface_digest_invalid/u)
  await assert.rejects(controller.pluginReadServiceAdminTable('other-project', 'server', 'sites', 'sites', artifactDigest), /bridge.context_changed/u)
})

await test('StudioPlugin peer catalog exposes project services and Core-backed peer methods only', async () => {
  const projectID = 'peer-project'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo service', version: '2.0.0' }
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/peer-project' },
    graph: { services: [service, echo] },
  } as Workspace })
  const metadataCalls: Array<[string, string, string]> = []
  const api = {
    readRuntimeServiceMetadata: (requestedProject: string, serviceID: string, view: string) => {
      metadataCalls.push([requestedProject, serviceID, view])
      return Promise.resolve(JSON.stringify({
        id: 'echo',
        capabilities: [{ id: 'echo.api', version: '1.0.0', endpoint: 'https://private.invalid', secret: 'must-not-cross-host' }],
        peerContracts: [{ id: 'echo.v1', version: '1.0.0', methods: ['echo.handle'], requestSchemaRef: 'private/path' }],
        runtime: { peerEndpoint: 'https://private.invalid' },
      }))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  assert.deepEqual(await controller.pluginReadServicePeerCatalog(projectID, 'server'), {
    services: [
      { id: 'server', name: 'Server', version: '1.0.0' },
      { id: 'echo', name: 'Echo service', version: '2.0.0' },
    ],
    truncated: false,
  })
  assert.deepEqual(await controller.pluginReadServicePeerCatalog(projectID, 'server', 'echo'), {
    methods: [{ id: 'echo.handle', version: '1.0.0' }],
  })
  assert.deepEqual(metadataCalls, [[projectID, 'echo', 'manifest']])
  await assert.rejects(controller.pluginReadServicePeerCatalog(projectID, 'server', '../echo'), /bridge.peer_target_unavailable/u)
  await assert.rejects(controller.pluginReadServicePeerCatalog('other-project', 'server'), /bridge.context_changed/u)
})

await test('StudioPlugin peer catalog rejects malformed and oversized live manifests', async () => {
  const projectID = 'invalid-peer-project'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo' }
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/invalid-peer-project' },
    graph: { services: [service, echo] },
  } as Workspace })
  const api = { readRuntimeServiceMetadata: () => Promise.resolve(JSON.stringify({ peerContracts: [{ id: 'echo.v1', version: '1.0.0', methods: ['../unsafe'] }] })) } as unknown as StudioAPI
  const controller = createStudioController(api)
  await assert.rejects(controller.pluginReadServicePeerCatalog(projectID, 'server', 'echo'), /bridge.peer_response_invalid/u)
})

await test('StudioPlugin receives only active safe secret references for a manifest-declared purpose', async () => {
  const projectID = 'secret-picker-project'
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/secret-picker-project' },
    graph: { services: [service] },
  } as Workspace })
  const item = { reference: `ssr:v1:${'b'.repeat(32)}`, serviceId: 'server', purpose: 'server.http.auth.credential', label: 'API token', state: 'active', createdAt: '2026-10-17T12:00:00Z' }
  let catalogReads = 0
  const api = {
    readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => Promise.resolve(view === 'manifest'
      ? JSON.stringify({ id: serviceID, secretPurposes: ['server.http.auth.credential'] })
      : JSON.stringify({})),
    readLocalServiceSecretReferences: (serviceID: string) => {
      catalogReads++
      return Promise.resolve(JSON.stringify({ schemaVersion: 'service-secret-references/v1', target: 'local', serviceId: serviceID, items: [item, { ...item, reference: `ssr:v1:${'c'.repeat(32)}`, state: 'revoked' }], pendingRotations: [], pendingRegistrations: [] }))
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  assert.deepEqual(await controller.pluginReadServiceSecretReferences(projectID, 'server', 'server.http.auth.credential'), {
    items: [{ reference: item.reference, label: item.label, state: 'active' }], truncated: false,
  })
  await assert.rejects(controller.pluginReadServiceSecretReferences(projectID, 'server', 'server.http.other'), /bridge.secret_purpose_not_declared/u)
  assert.equal(catalogReads, 1)
})

await test('StudioPlugin can attach a declared secret reference to a schema-declared route field', async () => {
  const projectID = 'secret-route-selection-project'
  const projectRoot = '/tmp/secret-route-selection-project'
  const purpose = 'server.http.auth.credential'
  const reference = `ssr:v1:${'d'.repeat(32)}`
  const schema = {
    type: 'object',
    properties: { config: { $ref: '#/$defs/config' }, schemaVersion: { type: 'integer' } },
    $defs: {
      config: { type: 'object', properties: { routes: { type: 'array', items: { $ref: '#/$defs/route' } } } },
      route: { type: 'object', properties: { features: { $ref: '#/$defs/routeFeatures' } } },
      routeFeatures: { type: 'object', properties: { auth: { $ref: '#/$defs/authFeature' } } },
      authFeature: { type: 'object', properties: { secretRef: {
        type: 'string', pattern: '^ssr:v1:[a-f0-9]{32}$', 'x-liapoldus-secret-reference': true,
        'x-studio-secret-purpose': purpose,
      } } },
    },
  }
  const manifest = {
    secretPurposes: [purpose],
    configurationUI: {
      version: 'service-configuration-ui/v1',
      groups: [{ id: 'auth', title: { ru: 'Аутентификация', en: 'Authentication' }, fields: [
        { path: '/config/routes/*/features/auth/secretRef', label: { ru: 'Секрет', en: 'Secret' }, widget: 'secret', secretPurpose: purpose },
      ] }],
    },
  }
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  let savedPatch: Record<string, unknown> | null = null
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ schemaVersion: 2, config: { routes: [{ features: { auth: {} } }] } }), digest: 'sha256:base' }),
    readServiceSettingsDraft: () => Promise.resolve({
      serviceId: 'server', settingsPath: service.settingsPath, schemaPath: service.settingsSchemaPath,
      baseDigest: 'sha256:base', patchJson: JSON.stringify({ config: { routes: {
        [configurationArrayOperationsKey]: [{ op: 'insert', index: 1, value: { id: 'test-route', features: { auth: {} } } }],
      } } }),
    }),
    saveServiceSettingsDraft: (_projectID: string, _serviceID: string, _baseDigest: string, patchJSON: string) => {
      savedPatch = JSON.parse(patchJSON) as Record<string, unknown>
      return Promise.resolve()
    },
    deleteServiceSettingsDraft: () => Promise.resolve(),
    readRuntimeServiceMetadata: liveMetadata(schema, manifest),
    readLocalServiceSecretReferences: (serviceID: string) => Promise.resolve(JSON.stringify({
      schemaVersion: 'service-secret-references/v1', target: 'local', serviceId: serviceID,
      items: [{ reference, serviceId: serviceID, purpose, label: 'temporary test credential', state: 'active', createdAt: '2026-10-17T12:00:00Z' }],
      pendingRotations: [], pendingRegistrations: [],
    })),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const result = await controller.pluginSelectServiceSecretReference(projectID, 'server',
    ['config', 'routes', '1', 'features', 'auth', 'secretRef'], purpose, reference)

  assert.equal(result.status, 'dirty')
  assert.ok(savedPatch)
  assert.equal(JSON.stringify(savedPatch).includes(reference), true)
  const routesPatch = (savedPatch as Record<string, unknown>).config as Record<string, unknown>
  const routeOperations = configurationArrayOperations(routesPatch.routes)
  assert.deepEqual(routeOperations?.map((operation) => operation.op), ['insert', 'set'])
  assert.deepEqual(Object.keys(routesPatch.routes as Record<string, unknown>), [configurationArrayOperationsKey])
  const merged = mergeConfiguration(
    { schemaVersion: 2, config: { routes: [{ features: { auth: {} } }] } },
    savedPatch,
  )
  const mergedConfig = merged.config as Record<string, unknown>
  const mergedRoutes = mergedConfig.routes as Array<Record<string, unknown>>
  assert.equal(mergedRoutes.length, 2)
  assert.equal((((mergedRoutes[1]?.features as Record<string, unknown>).auth as Record<string, unknown>).secretRef), reference)
  await assert.rejects(controller.pluginSelectServiceSecretReference(projectID, 'server',
    ['config', 'routes', '1', 'features', 'auth', 'unknown'], purpose, reference), /bridge.secret_schema_path_rejected/u)
  await assert.rejects(controller.pluginSelectServiceSecretReference(projectID, 'server',
    ['config', 'routes', '1', 'features', 'auth', 'secretRef'], 'server.http.other', reference), /bridge.secret_path_purpose_mismatch/u)
  await assert.rejects(controller.pluginSelectServiceSecretReference(projectID, 'server',
    ['config', 'routes', '1', 'features', 'auth', 'secretRef'], purpose, 'plaintext'), /bridge.secret_schema_path_rejected/u)
})

await test('StudioPlugin can select a schema-declared secret when configuration UI omits the specialized editor field', async () => {
  const projectID = 'secret-route-without-ui-hint'
  const purpose = 'server.http.auth.credential'
  const reference = `ssr:v1:${'f'.repeat(32)}`
  const schema = {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        properties: {
          routes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                features: {
                  type: 'object',
                  properties: {
                    auth: {
                      type: 'object',
                      properties: {
                        secretRef: {
                          type: 'string', pattern: '^ssr:v1:[a-f0-9]{32}$', 'x-liapoldus-secret-reference': true,
                          'x-studio-secret-purpose': purpose,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
  const projectRoot = '/tmp/secret-route-without-ui-hint'
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service], links: [] }, files: [],
  } as unknown as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ config: { routes: [{ features: { auth: {} } }] } }), digest: 'sha256:secret-ui-omitted' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    readRuntimeServiceMetadata: liveMetadata(schema, { secretPurposes: [purpose] }),
    readLocalServiceSecretReferences: (serviceID: string) => Promise.resolve(JSON.stringify({
      schemaVersion: 'service-secret-references/v1', target: 'local', serviceId: serviceID,
      items: [{ reference, serviceId: serviceID, purpose, label: 'temporary test credential', state: 'active', createdAt: '2026-10-18T12:00:00Z' }],
      pendingRotations: [], pendingRegistrations: [],
    })),
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  const result = await controller.pluginSelectServiceSecretReference(projectID, 'server',
    ['config', 'routes', '0', 'features', 'auth', 'secretRef'], purpose, reference)
  assert.equal(result.status, 'dirty')
  assert.equal(JSON.stringify(useStudioStore.getState().serviceSettingsDrafts[configurationDraftKey(projectRoot, 'server')]?.patch).includes(reference), true)
})

await test('StudioPlugin recovery copy is scoped to the open service and exact canonical Project digest', async () => {
  const projectID = 'settings-recovery-project'
  const projectRoot = '/tmp/settings-recovery-project'
  const digest = `sha256:${'e'.repeat(64)}`
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service] },
  } as Workspace })
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  const calls: unknown[][] = []
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: '{}', digest }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: liveMetadata(schema),
    createServiceSettingsRecoveryCopy: (requestedProjectID: string, serviceID: string, expectedDigest: string) => {
      calls.push([requestedProjectID, serviceID, expectedDigest])
      return Promise.resolve({ path: 'services/server/.server-settings-recovery-e.bak', digest: expectedDigest })
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  assert.deepEqual(await controller.pluginCreateServiceSettingsRecoveryCopy(projectID, 'server', digest), {
    path: 'services/server/.server-settings-recovery-e.bak', digest,
  })
  await assert.rejects(controller.pluginCreateServiceSettingsRecoveryCopy(projectID, 'server', `sha256:${'f'.repeat(64)}`), /bridge.recovery_source_changed/u)
  await assert.rejects(controller.pluginCreateServiceSettingsRecoveryCopy('other-project', 'server', digest), /bridge.context_changed/u)
  assert.deepEqual(calls, [[projectID, 'server', digest]])
})

await test('generic peer field verifies the selected Project service contract through Core metadata', async () => {
  const projectID = 'generic-peer-project'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo', version: '1.2.1', artifact: { id: 'echo', version: '1.2.1', platform: 'linux/arm64', digest: artifactDigest } }
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/generic-peer-project' },
    graph: { services: [service, echo] },
  } as Workspace })
  const reads: string[] = []
  const api = { readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => {
    reads.push(`${serviceID}:${view}`)
    if (view === 'status') return Promise.resolve(livePeerStatus(serviceID, '1.2.1'))
    return Promise.resolve(JSON.stringify({ id: serviceID, version: '1.2.1', peerContracts: [{ id: 'catalog.v1', version: '2.0.0' }] }))
  } } as unknown as StudioAPI
  const controller = createStudioController(api)

  assert.deepEqual(await controller.verifyServicePeerContract(projectID, 'server', 'echo', 'catalog.v1'), {
    id: 'echo', version: '1.2.1', contractVersion: '2.0.0',
  })
  assert.deepEqual(reads, ['echo:status', 'echo:manifest', 'echo:status'])
  await assert.rejects(controller.verifyServicePeerContract(projectID, 'server', 'missing', 'catalog.v1'), /peer.target_unavailable/u)
  await assert.rejects(controller.verifyServicePeerContract(projectID, 'server', 'echo', 'unknown.v1'), /peer.contract_not_advertised/u)
})

await test('generic peer field refuses stale context after the Core-backed metadata read', async () => {
  const projectID = 'generic-peer-context'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo', artifact: { id: 'echo', version: '1.0.0', platform: 'linux/arm64', digest: artifactDigest } }
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: '/tmp/generic-peer-context' },
    graph: { services: [service, echo] },
  } as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  let finishRead: (value: string) => void = (value: string) => { throw new Error(`Core metadata read did not start (${String(value.length)} bytes)`) }
  let signalReadStarted: () => void = () => {}
  const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve })
  let firstRead = true
  const api = { readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => {
    if (firstRead) {
      firstRead = false
      return new Promise<string>((resolve) => { finishRead = resolve; signalReadStarted() })
    }
    if (view === 'status') return Promise.resolve(livePeerStatus(serviceID, '1.0.0'))
    return Promise.resolve(JSON.stringify({ id: serviceID, version: '1.0.0', peerContracts: [{ id: 'catalog.v1', version: '2.0.0' }] }))
  } } as unknown as StudioAPI
  const controller = createStudioController(api)
  const pending = controller.verifyServicePeerContract(projectID, 'server', 'echo', 'catalog.v1')
  await readStarted
  useStudioStore.setState({ workspace: { ...workspace, project: workspace.project ? { ...workspace.project, id: 'other-project' } : { id: 'other-project', name: 'other-project', rootPath: '/tmp/other-project' } } })
  finishRead(livePeerStatus('echo', '1.0.0'))
  await assert.rejects(pending, /peer.context_changed/u)
})

await test('generic peer field refuses a stale result after switching roots with the same Project id', async () => {
  const projectID = 'generic-peer-root-context'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo', artifact: { id: 'echo', version: '1.0.0', platform: 'linux/arm64', digest: artifactDigest } }
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: '/tmp/generic-peer-root-a' },
    graph: { services: [service, echo] },
  } as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  let finishRead: (value: string) => void = () => { throw new Error('Core metadata read did not start') }
  let signalReadStarted: () => void = () => {}
  const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve })
  let firstRead = true
  const api = { readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => {
    if (firstRead) {
      firstRead = false
      return new Promise<string>((resolve) => { finishRead = resolve; signalReadStarted() })
    }
    if (view === 'status') return Promise.resolve(livePeerStatus(serviceID, '1.0.0'))
    return Promise.resolve(JSON.stringify({ id: serviceID, version: '1.0.0', peerContracts: [{ id: 'catalog.v1', version: '2.0.0' }] }))
  } } as unknown as StudioAPI
  const pending = createStudioController(api).verifyServicePeerContract(projectID, 'server', 'echo', 'catalog.v1')
  await readStarted
  useStudioStore.setState({ workspace: { ...workspace, project: { id: projectID, name: projectID, rootPath: '/tmp/generic-peer-root-b' } } })
  finishRead(livePeerStatus('echo', '1.0.0'))
  await assert.rejects(pending, /peer.context_changed/u)
})

await test('generic peer field rechecks the current artifact pin before accepting metadata', async () => {
  const projectID = 'generic-peer-current-pin'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo', version: '1.2.1', artifact: { id: 'echo', version: '1.2.1', platform: 'linux/arm64', digest: artifactDigest } }
  const workspace = {
    project: { id: projectID, name: projectID, rootPath: '/tmp/generic-peer-current-pin' },
    graph: { services: [service, echo] },
  } as Workspace
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace })
  let finishRead: (value: string) => void = () => { throw new Error('Core metadata read did not start') }
  let signalReadStarted: () => void = () => {}
  const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve })
  let firstRead = true
  const api = { readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => {
    if (firstRead) {
      firstRead = false
      return new Promise<string>((resolve) => { finishRead = resolve; signalReadStarted() })
    }
    if (view === 'status') return Promise.resolve(livePeerStatus(serviceID, '1.2.1'))
    return Promise.resolve(JSON.stringify({ id: serviceID, version: '1.2.1', peerContracts: [{ id: 'catalog.v1', version: '2.0.0' }] }))
  } } as unknown as StudioAPI
  const pending = createStudioController(api).verifyServicePeerContract(projectID, 'server', 'echo', 'catalog.v1')
  await readStarted
  const changedEcho: RuntimeService = { ...echo, artifact: { id: 'echo', version: '1.2.1', platform: 'linux/arm64', digest: `sha256:${'c'.repeat(64)}` } }
  useStudioStore.setState({ workspace: { ...workspace, graph: { services: [service, changedEcho], links: [] } } })
  finishRead(livePeerStatus('echo', '1.2.1'))
  await assert.rejects(pending, /peer.provenance_mismatch/u)
})

await test('generic peer field refuses a live contract when Core replica provenance differs from the Project pin', async () => {
  const projectID = 'generic-peer-provenance'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo', version: '1.2.1', artifact: { id: 'echo', version: '1.2.1', platform: 'linux/arm64', digest: artifactDigest } }
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/generic-peer-provenance' },
    graph: { services: [service, echo] },
  } as Workspace })
  let statusReads = 0
  const api = { readRuntimeServiceMetadata: (_projectID: string, serviceID: string, view: string) => {
    if (view === 'status') {
      statusReads += 1
      const status = JSON.parse(livePeerStatus(serviceID, '1.2.1')) as Record<string, unknown>
      if (statusReads === 1) status.artifactDigest = `sha256:${'b'.repeat(64)}`
      return Promise.resolve(JSON.stringify(status))
    }
    return Promise.resolve(JSON.stringify({ id: serviceID, version: '1.2.1', peerContracts: [{ id: 'catalog.v1', version: '2.0.0' }] }))
  } } as unknown as StudioAPI
  await assert.rejects(createStudioController(api).verifyServicePeerContract(projectID, 'server', 'echo', 'catalog.v1'), /peer.provenance_mismatch/u)
})

await test('Core-backed metadata reads used by peer pickers are serialized through the shared CLI queue', async () => {
  const projectID = 'serialized-peer-project'
  const echo: RuntimeService = { ...service, id: 'echo', name: 'Echo' }
  const forms: RuntimeService = { ...service, id: 'forms', name: 'Forms' }
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: '/tmp/serialized-peer-project' },
    graph: { services: [service, echo, forms] },
  } as Workspace })
  let concurrentReads = 0
  let maxConcurrentReads = 0
  const api = {
    readRuntimeServiceMetadata: (_projectID: string, serviceID: string) => new Promise<string>((resolve) => {
      concurrentReads += 1
      maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads)
      setTimeout(() => {
        concurrentReads -= 1
        resolve(JSON.stringify({ peerContracts: [{ id: `${serviceID}.v1`, version: '1.0.0', methods: [`${serviceID}.call`] }] }))
      }, 5)
    }),
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const [echoCatalog, formsCatalog] = await Promise.all([
    controller.pluginReadServicePeerCatalog(projectID, 'server', 'echo'),
    controller.pluginReadServicePeerCatalog(projectID, 'server', 'forms'),
  ])
  assert.deepEqual(echoCatalog, { methods: [{ id: 'echo.call', version: '1.0.0' }] })
  assert.deepEqual(formsCatalog, { methods: [{ id: 'forms.call', version: '1.0.0' }] })
  assert.equal(maxConcurrentReads, 1)
})

await test('StudioPlugin patch is rejected when the active Project changes during draft loading', async () => {
  const projectID = 'plugin-context-before'
  const projectRoot = '/tmp/plugin-context-before'
  const otherWorkspace = {
    project: { id: 'plugin-context-after', name: 'after', rootPath: '/tmp/plugin-context-after' },
    graph: { services: [], links: [] }, files: [],
  } as unknown as Workspace
  const initialWorkspace = {
    project: { id: projectID, name: 'before', rootPath: projectRoot },
    graph: { services: [{ ...service, settingsPath: 'services/server/settings.json' }], links: [] },
    files: [],
  } as unknown as Workspace
  const schema = { type: 'object', properties: { enabled: { type: 'boolean' } } }
  let persisted = 0
  let projectWrites = 0
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: initialWorkspace })
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: '{"enabled":false}', digest: 'sha256:context-before' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: liveMetadata(schema),
    saveServiceSettingsDraft: () => { persisted += 1; return Promise.resolve() },
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: () => { projectWrites += 1; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  await controller.pluginReadServiceSettings(projectID, 'server')
  const patch = controller.pluginPatchServiceSettings(projectID, 'server', ['enabled'], true)
  useStudioStore.setState({ workspace: otherWorkspace })

  await assert.rejects(patch, /bridge\.context_changed/u)
  await new Promise((resolve) => { setTimeout(resolve, 250) })
  assert.equal(persisted, 0, 'a stale StudioPlugin request must not persist a draft after Project switch')
  const oldDraft = useStudioStore.getState().serviceSettingsDrafts[configurationDraftKey(projectRoot, 'server')]
  assert.deepEqual(oldDraft?.patch, {}, 'the stale request must not mutate the previous Project draft')

  useStudioStore.setState({ workspace: initialWorkspace })
  useStudioStore.getState().updateServiceSettingsDraft(configurationDraftKey(projectRoot, 'server'), ['enabled'], true)
  const save = controller.pluginSaveServiceSettings(projectID, 'server')
  useStudioStore.setState({ workspace: otherWorkspace })
  await assert.rejects(save, /bridge\.context_changed/u)
  assert.equal(projectWrites, 0, 'a stale StudioPlugin save must not replace canonical Project settings')
})

await test('StudioPlugin settings bridge is project-scoped, redacted and shares the saved draft', async () => {
  const projectID = 'plugin-project'
  const projectRoot = '/tmp/plugin-project'
  useStudioStore.setState({
    serviceSettingsDrafts: {},
    workspace: {
      project: { id: projectID, name: 'plugin-project', rootPath: projectRoot },
      graph: { services: [service] },
    } as Workspace,
  })
  const schema = { type: 'object', properties: {
    address: { type: 'string' },
    config: { type: 'object', properties: { routes: { type: 'array', items: { $ref: '#/$defs/route' } } } },
    openRoutes: { type: 'array', items: { type: 'string' } },
    password: { type: 'string', writeOnly: true, 'x-sensitive': true },
  }, $defs: { route: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, token: { type: 'string', writeOnly: true, 'x-sensitive': true } } } } }
  let stored: Record<string, unknown> = { address: '127.0.0.1', config: { routes: [] }, openRoutes: [], password: 'must-not-cross-host' }
  let digest = 'sha256:before'
  let lastWriteScope: string[] = []
  let applyIntent: string[] = []
  const api = {
    ...recoveryStateAPI(projectID),
    readProjectSchema: (requestedProject: string, serviceID: string) => {
      assert.deepEqual([requestedProject, serviceID], [projectID, 'server'])
      return Promise.resolve(bytes(schema))
    },
    readProjectSettings: (requestedProject: string, serviceID: string) => {
      assert.deepEqual([requestedProject, serviceID], [projectID, 'server'])
      return Promise.resolve({ valuesJson: JSON.stringify({ ...stored, password: null }), digest })
    },
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: liveMetadata(schema),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
    writeProjectSettings: (requestedProject: string, serviceID: string, _expectedDigest: string, patchBytes: Uint8Array) => {
      lastWriteScope = [requestedProject, serviceID]
      stored = mergeConfiguration(stored, JSON.parse(new TextDecoder().decode(patchBytes)) as Record<string, unknown>)
      digest = 'sha256:after'
      return Promise.resolve()
    },
    runStudioCommandAndWait: (command: string, target: string) => { applyIntent = [command, target]; return Promise.resolve() },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  const initial = await controller.pluginReadServiceSettings(projectID, 'server')
  assert.deepEqual(initial.values, { address: '127.0.0.1', config: { routes: [] }, openRoutes: [], password: null })
  assert.equal(JSON.stringify(initial).includes('must-not-cross-host'), false)
  const changed = await controller.pluginPatchServiceSettings(projectID, 'server', ['address'], '0.0.0.0')
  assert.equal(changed.status, 'dirty')
  const routes = [{ id: 'echo' }]
  const routeDraft = await controller.pluginPatchServiceSettings(projectID, 'server', ['config', 'routes'], {
    '$studioArrayOps/v1': [{ op: 'insert', index: 0, value: routes[0] }],
  })
  assert.equal(routeDraft.status, 'dirty')
  assert.deepEqual(routeDraft.values.config, { routes })
  await assert.rejects(controller.pluginPatchServiceSettings(projectID, 'server', ['openRoutes'], {
    '$studioArrayOps/v1': [{ op: 'insert', index: 0, value: 'unsafe-operation' }],
  }), /bridge\.patch_array_contract_mismatch/u)
  const draftKey = configurationDraftKey(projectRoot, 'server')
  useStudioStore.getState().beginServiceSettingsContractRefresh(draftKey)
  await assert.rejects(controller.pluginPatchServiceSettings(projectID, 'server', ['config', 'routes'], {
    '$studioArrayOps/v1': [{ op: 'insert', index: 1, value: { id: 'second' } }],
  }),
    /bridge\.patch_draft_unchanged/u,
  )
  useStudioStore.getState().endServiceSettingsContractRefresh(draftKey)
  await assert.rejects(controller.pluginPatchServiceSettings(projectID, 'server', ['password'], 'attempt'), /bridge\.patch_path_rejected/u)
  await controller.pluginSaveServiceSettings(projectID, 'server')
  assert.deepEqual(lastWriteScope, [projectID, 'server'])
  assert.equal(stored.address, '0.0.0.0')
  assert.deepEqual(stored.config, { routes })
  assert.equal(stored.password, 'must-not-cross-host')
  assert.deepEqual(applyIntent, [], 'route changes are saved in Project and wait for explicit review before Core apply')
  assert.ok(useStudioStore.getState().applyReviewPaths.includes('server.config.routes.item-1: added (value-redacted)'))
  await controller.applyServiceSettings(draftKey)
  assert.deepEqual(applyIntent, ['dev.apply', 'local'])
  await assert.rejects(controller.pluginReadServiceSettings('another-project', 'server'), /bridge.context_changed/u)
})

await test('StudioPlugin can patch a safe leaf beneath nested local refs and protected route arrays', async () => {
  const projectID = 'route-ref-project'
  const projectRoot = '/tmp/route-ref-project'
  const route = { id: 'echo-route', api: { responses: [{
    contentType: 'application/json', schema: { type: 'object', additionalProperties: true }, example: {}, credentialMaterial: null,
  }] } }
  const schema = {
    type: 'object',
    properties: { config: { $ref: '#/$defs/config' } },
    $defs: {
      config: { type: 'object', properties: { routes: { type: 'array', items: { $ref: '#/$defs/route' } } } },
      route: { type: 'object', properties: { id: { type: 'string' }, api: { $ref: '#/$defs/api' } } },
      api: { type: 'object', properties: { responses: { type: 'array', items: { $ref: '#/$defs/response' } } } },
      response: { type: 'object', additionalProperties: false, required: ['contentType', 'schema', 'example'], properties: {
        contentType: { type: 'string' },
        schema: { type: 'object', additionalProperties: true, 'x-studio-json-document': true },
        example: {},
        credentialMaterial: { type: 'string', writeOnly: true },
      } },
    },
  }
  useStudioStore.setState({ serviceSettingsDrafts: {}, workspace: {
    project: { id: projectID, name: projectID, rootPath: projectRoot },
    graph: { services: [service] },
  } as Workspace })
  const api = {
    readProjectSchema: () => Promise.resolve(bytes(schema)),
    readProjectSettings: () => Promise.resolve({ valuesJson: JSON.stringify({ config: { routes: [route] } }), digest: 'sha256:route-ref' }),
    readServiceSettingsDraft: () => Promise.resolve(null),
    readRuntimeServiceMetadata: liveMetadata(schema),
    saveServiceSettingsDraft: () => Promise.resolve(),
    deleteServiceSettingsDraft: () => Promise.resolve(),
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  await controller.pluginReadServiceSettings(projectID, 'server')
  const updated = await controller.pluginPatchServiceSettings(projectID, 'server', [
    'config', 'routes', '0', 'api', 'responses', '0', 'contentType',
  ], 'text/plain')

  assert.equal(updated.status, 'dirty')
  assert.match(JSON.stringify(updated.values), /"contentType":"text\/plain"/u)
  assert.equal(JSON.stringify(updated.patch).includes('credentialMaterial'), false)

  const updatedResponseSchema = await controller.pluginPatchServiceSettings(projectID, 'server', [
    'config', 'routes', '0', 'api', 'responses', '0', 'schema',
  ], { type: 'string', minLength: 1 })
  assert.equal(updatedResponseSchema.status, 'dirty')
  assert.match(JSON.stringify(updatedResponseSchema.values), /"schema":\{"type":"string","minLength":1\}/u)
  assert.equal(JSON.stringify(updatedResponseSchema.patch).includes('credentialMaterial'), false)

  const withSecondResponse = await controller.pluginPatchServiceSettings(projectID, 'server', [
    'config', 'routes', '0', 'api', 'responses',
  ], {
    '$studioArrayOps/v1': [{
      op: 'insert', index: 1,
      value: { contentType: 'application/json', schema: { type: 'object', additionalProperties: true }, example: { message: 'opaque' } },
    }],
  })
  assert.equal(withSecondResponse.status, 'dirty')
  assert.match(JSON.stringify(withSecondResponse.values), /"message":"opaque"/u)
  assert.equal(JSON.stringify(withSecondResponse.patch).includes('credentialMaterial'), false)

  const withoutSecondResponse = await controller.pluginPatchServiceSettings(projectID, 'server', [
    'config', 'routes', '0', 'api', 'responses',
  ], {
    '$studioArrayOps/v1': [{ op: 'remove', index: 1 }],
  })
  assert.equal(withoutSecondResponse.status, 'dirty')
  assert.doesNotMatch(JSON.stringify(withoutSecondResponse.values), /"message":"opaque"/u)
  assert.match(JSON.stringify(withoutSecondResponse.values), /"contentType":"text\/plain"/u)
  assert.equal(JSON.stringify(withoutSecondResponse.patch).includes('credentialMaterial'), false)
})
