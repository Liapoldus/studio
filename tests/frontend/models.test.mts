import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductInfo, ServiceSettingsSchemaPreview, models } from '../../frontend/src/api/info.ts'
import { decodeWailsBytes } from '../../frontend/src/api/bytes.ts'
import { initialWorkspaceTabs, messageOf, operationReplicaOutcomes, previewWorkspaceMigration, projectPluginVersionsFromState, restoreWorkspaceState, summarizeCLIEvent, updateCLIStreamState, workspaceSnapshot, workspaceStateUpdate, workspaceStateWithApplyRecovery, workspaceStateWithProjectPluginVersions, type WorkspaceTab } from '../../frontend/src/models/studio.ts'
import { parseCoreServiceReadiness, parseServiceReadiness, runtimeServiceActionConfirmationText, runtimeStopConfirmationText } from '../../frontend/src/models/runtime.ts'
import { graphEdgeHandles } from '../../frontend/src/models/graph.ts'
import { groupDiagnostics } from '../../frontend/src/models/diagnostics.ts'
import type { StudioAPI } from '../../frontend/src/api/types.ts'
import { useStudioStore } from '../../frontend/src/stores/studio.ts'

await test('model preserves Wails factories and valid object/JSON payloads', () => {
  const value = { name: 'Studio', description: 'Shell', workspaceFeatures: ['project'] }
  assert.equal(models.ProductInfo, ProductInfo)
  assert.equal(JSON.stringify(new ProductInfo(value)), JSON.stringify(value))
  assert.equal(JSON.stringify(models.ProductInfo.createFrom(JSON.stringify(value))), JSON.stringify(value))
  const model = new ProductInfo(value)
  value.workspaceFeatures[0] = 'changed'
  assert.deepEqual(model.workspaceFeatures, ['project'])
  for (const invalid of [null, {}, { ...value, workspaceFeatures: [1] }]) {
    assert.throws(() => new ProductInfo(invalid), /Invalid Studio product information/u)
  }
})

await test('schema preview adapter validates bounded schema and exact review digests', () => {
  const source = {
    schemaJson: '{"type":"object"}',
    schemaDigest: `sha256:${'a'.repeat(64)}`,
    settingsDigest: `sha256:${'b'.repeat(64)}`,
    draftDigest: `sha256:${'c'.repeat(64)}`,
    valuesCompatible: true,
  }
  const preview = new ServiceSettingsSchemaPreview(source)
  assert.equal(preview.valuesCompatible, true)
  assert.equal(preview.schemaDigest, `sha256:${'a'.repeat(64)}`)
  assert.throws(() => new ServiceSettingsSchemaPreview({ ...source, draftDigest: 'unchecked' }), /Invalid Studio service settings schema preview/u)
  assert.throws(() => new ServiceSettingsSchemaPreview({ ...source, valuesCompatible: 'yes' }), /Invalid Studio service settings schema preview/u)
  assert.throws(() => new ServiceSettingsSchemaPreview({ ...source, schemaJson: 'x'.repeat(1_048_577) }), /Invalid Studio service settings schema preview/u)
})

await test('Wails byte responses decode both base64 and numeric-array payloads', () => {
  const expected = new TextEncoder().encode('{"statePath":"/tmp/core.sqlite"}')
  assert.deepEqual(decodeWailsBytes(btoa(new TextDecoder().decode(expected))), expected)
  assert.deepEqual(decodeWailsBytes(Array.from(expected)), expected)
  assert.throws(() => decodeWailsBytes({ data: 'not-bytes' }), /Unexpected Wails byte payload/u)
})

await test('CLI output renders bounded structured events without hiding diagnostics', () => {
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.output', payload: { state: 'missing' } }), '{"state":"missing"}')
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'diagnostic', message: 'safe failure' }), 'safe failure')
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'diagnostic', code: 'docker_mount_source_unavailable', message: 'Docker cannot access the Core state directory' }), 'docker_mount_source_unavailable: Docker cannot access the Core state directory')
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'diagnostic', code: 'token=secret', message: 'safe failure' }), 'safe failure')
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.output', payload: 'x'.repeat(700) }).length, 601)
})

await test('Wails error objects preserve actionable update diagnostics', () => {
  assert.equal(messageOf({ message: 'binary_not_elf: invalid executable' }, 'Could not inspect Core binary'), 'binary_not_elf: invalid executable')
  assert.equal(messageOf({ error: 'unsupported_platform: linux/386' }, 'Could not inspect Core binary'), 'unsupported_platform: linux/386')
  assert.equal(messageOf({ cause: new Error('target unavailable') }, 'fallback'), 'target unavailable')
  assert.equal(messageOf({ path: '/private/tmp/secret' }, 'Could not inspect Core binary'), 'Could not inspect Core binary')
})

await test('runtime status output shows actual container state without forwarding other inspect fields', () => {
  const payload = { text: JSON.stringify({
    schemaVersion: 'runtime-events/v1',
    type: 'runtime.status',
    containers: [
      { name: 'liapoldus-core', state: 'running', health: 'healthy', image: 'core:local' },
      { name: 'liapoldus-server', state: 'exited', image: 'runtime:local', secret: 'not-for-rendering' },
    ],
  }) }
  const summary = summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.output', payload })
  assert.equal(summary, 'Containers: liapoldus-core: running (healthy) · liapoldus-server: exited')
  assert.equal(summary.includes('runtime:local'), false)
  assert.equal(summary.includes('not-for-rendering'), false)
})

await test('operation output validates and presents only safe per-replica rollout outcomes', () => {
  const events = [{ schemaVersion: 'cli-events/v1', type: 'run.output', payload: {
    id: 'op-1', state: 'failed', replicaOutcomes: [
      { replicaId: 'server-1', desiredGeneration: 4, state: 'applied' },
      { replicaId: 'server-2', desiredGeneration: 4, state: 'failed', failureCode: 'target_lost', endpoint: 'https://secret.invalid' },
    ],
  } }]
  assert.deepEqual(operationReplicaOutcomes(events), [
    { replicaId: 'server-1', desiredGeneration: 4, state: 'applied' },
    { replicaId: 'server-2', desiredGeneration: 4, state: 'failed', failureCode: 'target_lost' },
  ])
  assert.deepEqual(operationReplicaOutcomes([{ schemaVersion: 'cli-events/v1', type: 'run.output', payload: { replicaOutcomes: [{ replicaId: 'server-1', desiredGeneration: 4, state: 'failed', failureCode: 'https://unsafe' }] } }]), [
    { replicaId: 'server-1', desiredGeneration: 4, state: 'failed' },
  ])
})

await test('stack stop confirmation names the selected target and exactly describes removed state', () => {
  const russian = runtimeStopConfirmationText('local-dev', 'ru')
  assert.match(russian, /target local-dev/u)
  assert.match(russian, /runtime-контейнеры и временный staging/u)
  assert.match(russian, /Core DB, credentials и исходные бинарники останутся без изменений/u)
  const english = runtimeStopConfirmationText('local-dev', 'en')
  assert.match(english, /For target local-dev/u)
  assert.match(english, /stop and remove its runtime containers and temporary staging/u)
  assert.match(english, /Project files, Core DB, credentials, and source binaries will remain unchanged/u)
})

await test('per-service stop and restart confirmations identify the exact service and target', () => {
  const stop = runtimeServiceActionConfirmationText('stop', 'server', 'Server API', 'local', 'ru')
  assert.match(stop, /target local/u)
  assert.match(stop, /Server API \(server\)/u)
  assert.match(stop, /только выбранный сервис/u)
  assert.match(stop, /Project, Core и другие сервисы не изменятся/u)
  const restart = runtimeServiceActionConfirmationText('restart', 'echo', 'Echo', 'local', 'en')
  assert.match(restart, /For target local/u)
  assert.match(restart, /only the selected service Echo \(echo\)/u)
  assert.match(restart, /briefly become unavailable/u)
  assert.match(restart, /Project, Core, and other services will remain unchanged/u)
})

await test('CLI operation observation has explicit running, cancelling and stopped states', () => {
  let state = updateCLIStreamState('idle', { schemaVersion: 'cli-events/v1', type: 'run.started' })
  assert.equal(state, 'running')
  state = updateCLIStreamState(state, { schemaVersion: 'cli-events/v1', type: 'run.cancel_requested' })
  assert.equal(state, 'cancelling')
  state = updateCLIStreamState(state, { schemaVersion: 'cli-events/v1', type: 'run.cancelled' })
  assert.equal(state, 'idle')

  useStudioStore.setState({ cliEvents: [], cliStreamState: 'idle' })
  useStudioStore.getState().pushCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.started' })
  for (let index = 0; index < 120; index += 1) useStudioStore.getState().pushCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.progress' })
  assert.equal(useStudioStore.getState().cliEvents.length, 100)
  assert.equal(useStudioStore.getState().cliStreamState, 'running')
  useStudioStore.getState().pushCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.cancel_requested' })
  assert.equal(useStudioStore.getState().cliStreamState, 'cancelling')
  useStudioStore.getState().pushCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.cancelled' })
  assert.equal(useStudioStore.getState().cliStreamState, 'idle')
  useStudioStore.setState({ cliEvents: [] })
})

await test('Core-backed service status distinguishes ready, not-ready and unavailable payloads', () => {
  const replica = { replicaId: 'echo-1', artifactVersion: '1.0.0', artifactDigest: `sha256:${'a'.repeat(64)}`, ready: true, identity: { instanceId: 'echo', replicaId: 'echo-1' }, readiness: { instanceId: 'echo', replicaId: 'echo-1', ready: true, generation: '3', pendingGeneration: '', schemaVersion: '1' }, configuration: { desiredGeneration: 3, appliedGeneration: 3, state: 'acknowledged' } }
  assert.equal(parseServiceReadiness(JSON.stringify({ instanceId: 'echo', replicas: [replica] })), 'ready')
  const notReady = { ...replica, ready: false, readiness: { ...replica.readiness, ready: false } }
  assert.equal(parseServiceReadiness(JSON.stringify({ instanceId: 'echo', replicas: [notReady] })), 'not-ready')
  const stale = { ...replica, replicaId: 'echo-2', ready: false, identity: { instanceId: 'echo', replicaId: 'echo-2' }, readiness: { ...replica.readiness, replicaId: 'echo-2', ready: false, pendingGeneration: '4' } }
  assert.equal(parseServiceReadiness(JSON.stringify({ instanceId: 'echo', replicas: [replica, stale] })), 'degraded')
  const partialApply = { ...replica, configuration: { desiredGeneration: 4, appliedGeneration: 3, state: 'stale' } }
  assert.equal(parseServiceReadiness(JSON.stringify({ instanceId: 'echo', replicas: [partialApply] })), 'not-ready')
  const impossibleAck = { ...replica, configuration: { desiredGeneration: 4, appliedGeneration: 3, state: 'acknowledged' } }
  assert.equal(parseServiceReadiness(JSON.stringify({ instanceId: 'echo', replicas: [impossibleAck] })), 'unknown')
  assert.equal(parseServiceReadiness('{"instanceId":"echo"}'), 'unknown')
  assert.equal(parseServiceReadiness('not-json'), 'unknown')
})

await test('SDK readiness display does not claim replica provenance or configuration convergence', () => {
  const status = {
    instanceId: 'echo',
    identity: { instanceId: 'echo', replicaId: 'echo', contractVersion: 'liapoldus.service-sdk.http.v2', appliedGeneration: '23' },
    readiness: { instanceId: 'echo', replicaId: 'echo', generation: '23', pendingGeneration: '', schemaVersion: '1', ready: true },
  }
  assert.equal(parseCoreServiceReadiness(JSON.stringify(status), 'echo'), 'ready')
  assert.equal(parseCoreServiceReadiness(JSON.stringify({ ...status, readiness: { ...status.readiness, ready: false } }), 'echo'), 'not-ready')
  assert.equal(parseCoreServiceReadiness(JSON.stringify({ ...status, readiness: { ...status.readiness, pendingGeneration: '24' } }), 'echo'), 'degraded')
  assert.equal(parseCoreServiceReadiness(JSON.stringify(status), 'server'), 'unknown')
  assert.equal(parseCoreServiceReadiness('{"instanceId":"echo"}', 'echo'), 'unknown')
})

await test('workspace migration preview retires file/runtime tabs and preserves extension routes and layout', async () => {
  const tabs = [{ id: 'plugins', kind: 'plugins', title: 'Extensions' }, { id: 'studio-plugin:p:1:ui', kind: 'studio-plugin', title: 'UI', pluginId: 'p', pluginVersion: '1', surfaceId: 'ui', route: 'ui/index.html' }, { id: 'files', kind: 'files', title: 'Files' }, { id: 'artifacts', kind: 'artifacts', title: 'Artifacts' }, { id: 'runtime', kind: 'runtime', title: 'Runtime' }, { id: 'canvas', kind: 'canvas', title: 'Canvas' }]
  const layout = { 'neutral-id': { x: -12, y: 48 } }
  const before = JSON.stringify({ schemaVersion: 'workspace/v3', tabs, activeTabId: 'plugins', layout, userData: { retained: true } })
  const preview = previewWorkspaceMigration(before)
  assert.equal(preview.before, before)
  assert.equal(preview.changed, true)
  const after: unknown = JSON.parse(preview.after)
  const { pluginId, pluginVersion, ...extension } = tabs[1]
  assert.deepEqual(after, { schemaVersion: 'workspace/v5', tabs: [{ ...tabs[0], id: 'studio-plugins', kind: 'studio-plugins' }, { ...extension, studioPluginId: pluginId, studioPluginVersion: pluginVersion }, tabs[5]], activeTabId: 'studio-plugins', layout, userData: { retained: true } })
  assert.equal(previewWorkspaceMigration(preview.after).changed, false)
  const restored = await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve({ tabsJson: before, layoutJson: '{}' }) } as unknown as StudioAPI)
  assert.deepEqual(restored.tabs.map((tab) => tab.id), ['studio-plugins', 'studio-plugin:p:1:ui', 'canvas'])
  assert.equal(restored.activeTabId, 'studio-plugins')
  assert.deepEqual(restored.layout, layout)
  assert.equal(restored.writable, true)
  const saved = { projectId: 'p', tabsJson: before, layoutJson: JSON.stringify({ nodes: layout, custom: 'keep' }), filtersJson: '{"mine":true}' }
  const update = workspaceStateUpdate(saved, workspaceSnapshot(restored))
  const stored: unknown = JSON.parse(update.tabsJson)
  assert.deepEqual(stored, after)
  assert.equal(update.filtersJson, saved.filtersJson)
  assert.deepEqual(JSON.parse(update.layoutJson) as unknown, { nodes: layout, custom: 'keep', schemaVersion: 'workspace/v5' })
  assert.throws(() => previewWorkspaceMigration('{"schemaVersion":"workspace/v99","tabs":[]}'))
  const unsupported = await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve({ tabsJson: '{"schemaVersion":"workspace/v99","tabs":[]}', layoutJson: '{}' }) } as unknown as StudioAPI)
  assert.equal(unsupported.writable, false)
})

await test('Project plugin versions persist in workspace extension state without changing UI filters', () => {
  const saved = { projectId: 'project-plugins', layoutJson: '{}', tabsJson: JSON.stringify({ schemaVersion: 'workspace/v5', activeTabId: 'canvas', tabs: [{ id: 'canvas', kind: 'canvas', title: 'Canvas' }], layout: {}, extensionState: { custom: 'preserved' }, applyRecovery: { schemaVersion: 'studio-apply-recovery/v2', state: 'confirmation-required', target: 'local' } }), filtersJson: '{"serviceFilter":"ready"}' }
  const updated = workspaceStateWithProjectPluginVersions(saved, { 'liapoldus.server-editor': '0.3.50' })
  const decoded = JSON.parse(updated.tabsJson) as Record<string, unknown>
  assert.deepEqual(projectPluginVersionsFromState(updated), { 'liapoldus.server-editor': '0.3.50' })
  assert.deepEqual(decoded.extensionState, { custom: 'preserved', studioPlugins: { 'liapoldus.server-editor': '0.3.50' } })
  assert.deepEqual(decoded.applyRecovery, { schemaVersion: 'studio-apply-recovery/v2', state: 'confirmation-required', target: 'local' })
  assert.equal(updated.filtersJson, saved.filtersJson)
  const empty = workspaceStateWithProjectPluginVersions({ ...saved, tabsJson: '[]' }, {})
  assert.deepEqual(projectPluginVersionsFromState(empty), {})
})

await test('graph edges use facing handles in either caller/target layout', () => {
  assert.deepEqual(graphEdgeHandles({ x: 0, y: 0 }, { x: 400, y: 0 }), { sourceHandle: 'out-right', targetHandle: 'in-left' })
  assert.deepEqual(graphEdgeHandles({ x: 400, y: 0 }, { x: 0, y: 0 }), { sourceHandle: 'out-left', targetHandle: 'in-right' })
})

await test('repeated diagnostics are grouped without losing count or latest timestamp', () => {
  const diagnostic = { schemaVersion: 'diagnostics/v1', owner: 'cli', code: 'cli.protocol', severity: 'error', message: 'invalid event', operationId: '', target: '' }
  const groups = groupDiagnostics([
    { ...diagnostic, timestamp: '2026-01-01T00:00:00Z' },
    { ...diagnostic, timestamp: '2026-01-01T00:00:01Z' },
    { ...diagnostic, code: 'cli.exit', timestamp: '2026-01-01T00:00:02Z' },
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[1]?.count, 2)
  assert.equal(groups[1]?.diagnostic.timestamp, '2026-01-01T00:00:01Z')
})

await test('workspace v3 restore validates and retires removed tabs; unknown versions fail closed', async () => {
  const api = {
    readWorkspaceState: () => Promise.resolve({
      tabsJson: JSON.stringify({
        schemaVersion: 'workspace/v3', activeTabId: 'files',
        tabs: [null, { id: 'forged', kind: 'canvas', title: 'Forged canvas' }, { id: 'files', kind: 'files', title: 'Files' }, { id: 'files', kind: 'files', title: 'Duplicate' }, { id: 'bad', kind: 'studio-plugin', title: 'Bad', pluginId: 'p', pluginVersion: '1', surfaceId: 'a', route: '../index.html' }],
        layout: { 'svc-a': { x: 12, y: 40 }, broken: { x: Number.NaN, y: 0 } },
      }),
      layoutJson: '',
    }),
  } as unknown as StudioAPI
  const restored = await restoreWorkspaceState(api)
  assert.deepEqual(restored.tabs.map(({ id }) => id), ['canvas'])
  assert.equal(restored.activeTabId, 'canvas')
  assert.deepEqual(restored.layout, { 'svc-a': { x: 12, y: 40 } })
  const legacy = await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve({ tabsJson: '{"schemaVersion":"workspace/v2"}', layoutJson: '' }) } as unknown as StudioAPI)
  assert.deepEqual(legacy.tabs, initialWorkspaceTabs())
  assert.equal(legacy.activeTabId, 'canvas')
})

await test('apply recovery marker survives workspace updates and restores ambiguous runs as explicit confirmation', async () => {
  const saved = { projectId: 'recovery-project', layoutJson: '{}', tabsJson: JSON.stringify({ schemaVersion: 'workspace/v4', activeTabId: 'canvas', tabs: [{ id: 'canvas', kind: 'canvas', title: 'Canvas' }], layout: {}, extensionState: { retained: true } }), filtersJson: '{}' }
  const applying = workspaceStateWithApplyRecovery(saved, 'applying', 'op-123')
  assert.deepEqual(JSON.parse(applying.tabsJson), {
    schemaVersion: 'workspace/v5', activeTabId: 'canvas', tabs: [{ id: 'canvas', kind: 'canvas', title: 'Canvas' }], layout: {}, extensionState: { retained: true },
    applyRecovery: { schemaVersion: 'studio-apply-recovery/v2', state: 'applying', target: 'local', operationId: 'op-123' },
  })
  const updated = workspaceStateUpdate(applying, workspaceSnapshot({ activeTabId: 'canvas', tabs: initialWorkspaceTabs(), layout: {} }))
  assert.equal((JSON.parse(updated.tabsJson) as { applyRecovery: { state: string } }).applyRecovery.state, 'applying')
  const restored = await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve(updated) } as unknown as StudioAPI)
  assert.equal(restored.applyRecoveryStatus, 'confirmation-required')
  assert.equal(restored.applyRecoveryOperationId, 'op-123')

  const cleared = workspaceStateWithApplyRecovery(updated, 'none')
  const clearedJson = JSON.parse(cleared.tabsJson) as Record<string, unknown>
  assert.equal(Object.hasOwn(clearedJson, 'applyRecovery'), false)
  assert.deepEqual(clearedJson.extensionState, { retained: true })

  const initialized = workspaceStateWithApplyRecovery({ ...saved, tabsJson: '[]' }, 'confirmation-required')
  assert.equal((JSON.parse(initialized.tabsJson) as Record<string, unknown>).schemaVersion, 'workspace/v5')
  assert.equal((await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve(initialized) } as unknown as StudioAPI)).applyRecoveryStatus, 'confirmation-required')
})

await test('malformed apply recovery markers restore fail-closed', async () => {
  for (const marker of [
    { schemaVersion: 'future/v2', state: 'none' },
    { schemaVersion: 'studio-apply-recovery/v1', state: 'unknown' },
    { schemaVersion: 'studio-apply-recovery/v2', state: 'applying', target: 'remote', operationId: 'op-123' },
    { schemaVersion: 'studio-apply-recovery/v2', state: 'applying', target: 'local', operationId: '../unsafe' },
    null,
  ]) {
    const restored = await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve({ projectId: 'p', tabsJson: JSON.stringify({ schemaVersion: 'workspace/v4', tabs: [], applyRecovery: marker }), layoutJson: '{}', filtersJson: '{}' }) } as unknown as StudioAPI)
    assert.equal(restored.applyRecoveryStatus, 'confirmation-required')
    assert.equal(restored.applyRecoveryOperationId, null)
  }
})

await test('Studio plugin workspace tabs retain the project and selected service context', async () => {
  const surface = { studioPluginId: 'liapoldus.server-editor', version: '0.3.16', id: 'server-editor', title: 'Server', route: 'server-editor/ui/index.html', context: 'service' as const }
  useStudioStore.setState({ tabs: initialWorkspaceTabs(), activeTabId: 'canvas', view: 'workspace' })
  useStudioStore.getState().openStudioPluginSurface(surface, { projectId: 'server-echo-studio', serviceId: 'server' })
  const tab = useStudioStore.getState().tabs.find((item) => item.kind === 'studio-plugin')
  assert.equal(tab?.projectId, 'server-echo-studio')
  assert.equal(tab.serviceId, 'server')
  const snapshot = workspaceSnapshot(useStudioStore.getState())
  assert.equal(snapshot.tabs.find((item) => item.kind === 'studio-plugin')?.serviceId, 'server')

  const restored = await restoreWorkspaceState({ readWorkspaceState: () => Promise.resolve({ tabsJson: JSON.stringify(snapshot), layoutJson: '{}' }) } as unknown as StudioAPI)
  assert.equal(restored.tabs.find((item) => item.kind === 'studio-plugin')?.projectId, 'server-echo-studio')
  assert.equal(restored.tabs.find((item) => item.kind === 'studio-plugin')?.serviceId, 'server')

  useStudioStore.getState().openStudioPluginSurface(surface, { projectId: 'server-echo-studio', serviceId: 'echo' })
  assert.equal(useStudioStore.getState().tabs.filter((item) => item.kind === 'studio-plugin').length, 2)
  assert.equal(useStudioStore.getState().tabs.find((item) => item.kind === 'studio-plugin' && item.serviceId === 'echo')?.serviceId, 'echo')
  useStudioStore.setState({ tabs: initialWorkspaceTabs(), activeTabId: 'canvas', view: 'workspace' })
})

await test('workspace tabs open, activate, reorder, and close without a file manager tab', () => {
  const reportsTab: WorkspaceTab = { id: 'reports', kind: 'reports', title: 'Reports' }
  const store = useStudioStore.getState()
  store.setTabs([{ id: 'canvas', kind: 'canvas', title: 'Canvas' }, reportsTab], 'canvas')
  useStudioStore.getState().setActiveTab(reportsTab.id)
  assert.equal(useStudioStore.getState().activeTabId, 'reports')
  useStudioStore.getState().reorderTabs('reports', 'canvas')
  assert.deepEqual(useStudioStore.getState().tabs.map(({ id }) => id), ['reports', 'canvas'])
  useStudioStore.getState().closeTab('reports')
  assert.equal(useStudioStore.getState().activeTabId, 'canvas')
})
