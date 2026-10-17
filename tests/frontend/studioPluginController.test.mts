import assert from 'node:assert/strict'
import test from 'node:test'
import type { StudioAPI } from '../../frontend/src/api/types.ts'
import { createStudioController } from '../../frontend/src/controllers/studioController.ts'
import { useStudioStore } from '../../frontend/src/stores/studio.ts'

const digest = `sha256:${'b'.repeat(64)}`
const manifest = {
  id: 'liapoldus.server-editor', name: 'Server Editor', version: '0.3.0', studioRange: '>=0.1.0',
  permissions: ['service.settings.read', 'service.settings.write'],
  surfaces: [{ id: 'server-editor', kind: 'page', title: 'Server', route: 'ui/index.html' }],
  tools: [],
}

await test('Studio plugin install forwards the reviewed digest and exact permission set', async () => {
  let installArgs: unknown[] = []
  const api = {
    inspectStudioPlugin: () => Promise.resolve(JSON.stringify({ manifest, digest, signed: false, files: ['/private/package/path'] })),
    installStudioPlugin: (...args: unknown[]) => {
      installArgs = args
      return Promise.resolve(JSON.stringify({ manifest, digest, path: '/private/installed/path' }))
    },
    installedStudioPluginManifests: () => Promise.resolve(JSON.stringify([{ manifest, digest, signed: false, grantedPermissions: manifest.permissions }])) ,
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const preview = await controller.inspectStudioPluginPackage('/private/package/path')
  await controller.installStudioPluginPackage('/private/package/path', preview, 'Reviewed local package')

  assert.deepEqual(installArgs, ['/private/package/path', digest, true, 'Reviewed local package', manifest.permissions])
  assert.deepEqual(useStudioStore.getState().studioPluginSurfaces, [{
    studioPluginId: manifest.id, version: manifest.version, id: 'server-editor', title: 'Server', route: 'ui/index.html',
    permissions: manifest.permissions, grantedPermissions: manifest.permissions,
  }])
})

await test('removing a Studio plugin closes its open surface tabs and refreshes the registry view', async () => {
  const closed: string[] = []
  let removeArgs: string[] = []
  const api = {
    removeStudioPlugin: (id: string, version: string) => { removeArgs = [id, version]; return Promise.resolve() },
    installedStudioPluginManifests: () => Promise.resolve('[]'),
  } as unknown as StudioAPI
  useStudioStore.setState({
    tabs: [{ id: 'studio-plugin:liapoldus.server-editor:0.3.0:server-editor', kind: 'studio-plugin', title: 'Server', studioPluginId: manifest.id, studioPluginVersion: manifest.version, surfaceId: 'server-editor', route: 'ui/index.html' }],
    activeTabId: 'studio-plugin:liapoldus.server-editor:0.3.0:server-editor',
    closeTab: (id: string) => { closed.push(id); useStudioStore.setState({ tabs: [], activeTabId: 'canvas' }) },
  })
  await createStudioController(api).removeStudioPluginPackage(manifest.id, manifest.version)
  assert.deepEqual(removeArgs, [manifest.id, manifest.version])
  assert.deepEqual(closed, ['studio-plugin:liapoldus.server-editor:0.3.0:server-editor'])
  assert.deepEqual(useStudioStore.getState().studioPluginSurfaces, [])
})

await test('service artifact selection refreshes the Project file index after native import', async () => {
  const prior = useStudioStore.getState()
  const service = {
    id: 'server', name: 'Server', version: '1.0.0', manifestVersion: 'service/v1',
    servicePath: 'services/server/service.yaml', settingsPath: 'services/server/settings.json',
    settingsSchemaPath: 'schemas/server/settings.schema.json', configured: true,
    problemCount: 0, linkPaths: [],
  }
  const baseWorkspace = {
    project: { id: 'project-1', name: 'Test', rootPath: '/tmp/test-project' },
    files: [], git: { branch: 'main', revision: 'abc', changes: [], dirty: false, available: true, conflict: false },
    graph: { services: [service], links: [] },
  }
  const importedPath = 'resources/site-1234567890abcdef.tar.gz'
  let workspaceReads = 0
  const api = {
    selectRuntimeServiceResourceArtifact: () => Promise.resolve(importedPath),
    workspace: () => {
      workspaceReads += 1
      return Promise.resolve({ ...baseWorkspace, files: [{ path: importedPath, kind: 'file', bytes: 128 }] })
    },
  } as unknown as StudioAPI
  useStudioStore.getState().setWorkspace(baseWorkspace)

  const selected = await createStudioController(api).pluginSelectServiceResourceArtifact('project-1', 'server')
  assert.deepEqual(selected, { path: importedPath })
  assert.equal(workspaceReads, 1)
  assert.equal(useStudioStore.getState().workspace?.files.some((file) => file.path === importedPath), true)
  useStudioStore.setState({ workspace: prior.workspace })
})

await test('Project certificate import refreshes the host file index before accepting the reference', async () => {
  const priorWorkspace = useStudioStore.getState().workspace
  const service = {
    id: 'server', name: 'Server', version: '1.0.0', manifestVersion: 'service/v1',
    servicePath: 'services/server/service.yaml', settingsPath: 'services/server/settings.json',
    settingsSchemaPath: 'schemas/server/settings.schema.json', configured: true,
    problemCount: 0, linkPaths: [],
  }
  const baseWorkspace = {
    project: { id: 'project-1', name: 'Test', rootPath: '/tmp/test-project' },
    files: [], git: { branch: 'main', revision: 'abc', changes: [], dirty: false, available: true, conflict: false },
    graph: { services: [service], links: [] },
  }
  const importedPath = 'resources/certificate-0123456789abcdef.crt'
  let importedResourceID = ''
  const api = {
    importRuntimeServiceProjectCertificate: (_projectID: string, _serviceID: string, resourceID: string) => {
      importedResourceID = resourceID
      return Promise.resolve(importedPath)
    },
    workspace: () => Promise.resolve({ ...baseWorkspace, files: [{ path: importedPath, kind: 'file', bytes: 1024 }] }),
  } as unknown as StudioAPI
  useStudioStore.getState().setWorkspace(baseWorkspace)

  const selected = await createStudioController(api).importProjectCertificateResource('project-1', 'server', 'tls-certificates')
  assert.equal(selected, importedPath)
  assert.equal(importedResourceID, 'tls-certificates')
  assert.equal(useStudioStore.getState().workspace?.files.some((file) => file.path === importedPath), true)
  useStudioStore.setState({ workspace: priorWorkspace })
})

await test('resource publication operation watch is restricted to the operation created for its service', async () => {
  const priorWorkspace = useStudioStore.getState().workspace
  const service = {
    id: 'server', name: 'Server', version: '1.0.0', manifestVersion: 'service/v1',
    servicePath: 'services/server/service.yaml', settingsPath: 'services/server/settings.json',
    settingsSchemaPath: 'schemas/server/settings.schema.json', configured: true,
    problemCount: 0, linkPaths: [],
  }
  useStudioStore.getState().setWorkspace({
    project: { id: 'project-1', name: 'Test', rootPath: '/tmp/test-project' },
    files: [], git: { branch: 'main', revision: 'abc', changes: [], dirty: false, available: true, conflict: false },
    graph: { services: [service], links: [] },
  })
  let onEvent: ((event: { type: string; target?: string; operationId?: string; state?: string; code?: string }) => void) | undefined
  const calls: unknown[][] = []
  const api = {
    publishRuntimeServiceResourceJSON: () => Promise.resolve(JSON.stringify({ operationId: 'publish-1', state: 'pending' })),
    onCLIEvent: (callback: typeof onEvent) => { onEvent = callback; return () => { onEvent = undefined } },
    runStudioCommandAndWait: (...args: unknown[]) => {
      calls.push(args)
      onEvent?.({ type: 'operation.updated', target: 'local', operationId: 'publish-1', state: 'succeeded', code: 'secret path' })
      return Promise.resolve()
    },
  } as unknown as StudioAPI
  const controller = createStudioController(api)
  const submitted = await controller.pluginPublishServiceResource('project-1', 'server', {
    pageId: 'sites', actionId: 'publish', artifactPath: 'resources/site.tar.gz', contentType: 'application/gzip', metadata: { siteId: 'docs' },
  })
  assert.deepEqual(submitted, { operationId: 'publish-1', state: 'pending' })
  assert.deepEqual(await controller.pluginWatchServiceResourceOperation('project-1', 'server', 'publish-1'), {
    operationId: 'publish-1', state: 'succeeded',
  })
  assert.deepEqual(calls, [['operation.watch', 'local', 'publish-1']])
  await assert.rejects(controller.pluginWatchServiceResourceOperation('project-1', 'server', 'other-operation'), /bridge\.operation_scope_invalid/u)
  useStudioStore.setState({ workspace: priorWorkspace })
})

await test('registry refresh rebinds duplicate version tabs to the newest package without losing context', () => {
  const prior = useStudioStore.getState()
  useStudioStore.setState({
    tabs: [
      { id: 'canvas', kind: 'canvas', title: 'Canvas' },
      { id: 'studio-plugin:liapoldus.server-editor:0.3.16:server-editor', kind: 'studio-plugin', title: 'Server', studioPluginId: manifest.id, studioPluginVersion: '0.3.16', surfaceId: 'server-editor', route: 'old/index.html', projectId: 'project-1', serviceId: 'server' },
      { id: 'studio-plugin:liapoldus.server-editor:0.3.27:server-editor', kind: 'studio-plugin', title: 'Server', studioPluginId: manifest.id, studioPluginVersion: '0.3.27', surfaceId: 'server-editor', route: 'old/index.html', projectId: 'project-1', serviceId: 'server' },
    ],
    activeTabId: 'studio-plugin:liapoldus.server-editor:0.3.16:server-editor',
  })
  useStudioStore.getState().setStudioPluginSurfaces([
    { studioPluginId: manifest.id, version: '0.3.16', id: 'server-editor', title: 'Server old', route: 'old/index.html' },
    { studioPluginId: manifest.id, version: '0.3.29', id: 'server-editor', title: 'Server', route: 'ui/index.html' },
  ])
  const state = useStudioStore.getState()
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['canvas', 'studio-plugin:liapoldus.server-editor:0.3.29:server-editor'])
  assert.equal(state.activeTabId, 'studio-plugin:liapoldus.server-editor:0.3.29:server-editor')
  assert.equal(state.tabs[1]?.serviceId, 'server')
  assert.equal(state.tabs[1]?.route, 'ui/index.html')
  useStudioStore.setState({ tabs: prior.tabs, activeTabId: prior.activeTabId, studioPluginSurfaces: prior.studioPluginSurfaces })
})

await test('workspace restore after plugin registry refresh also collapses old package tabs', () => {
  const prior = useStudioStore.getState()
  useStudioStore.getState().setStudioPluginSurfaces([
    { studioPluginId: manifest.id, version: '0.3.29', id: 'server-editor', title: 'Server', route: 'ui/index.html' },
  ])
  useStudioStore.getState().setTabs([
    { id: 'canvas', kind: 'canvas', title: 'Canvas' },
    { id: 'studio-plugin:liapoldus.server-editor:0.3.16:server-editor', kind: 'studio-plugin', title: 'Server', studioPluginId: manifest.id, studioPluginVersion: '0.3.16', surfaceId: 'server-editor', route: 'old/index.html', projectId: 'project-1' },
    { id: 'studio-plugin:liapoldus.server-editor:0.3.27:server-editor', kind: 'studio-plugin', title: 'Server', studioPluginId: manifest.id, studioPluginVersion: '0.3.27', surfaceId: 'server-editor', route: 'old/index.html', projectId: 'project-1', serviceId: 'server' },
  ], 'studio-plugin:liapoldus.server-editor:0.3.27:server-editor')
  const state = useStudioStore.getState()
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['canvas', 'studio-plugin:liapoldus.server-editor:0.3.29:server-editor'])
  assert.equal(state.activeTabId, 'studio-plugin:liapoldus.server-editor:0.3.29:server-editor')
  assert.equal(state.tabs[1]?.serviceId, 'server')
  useStudioStore.setState({ tabs: prior.tabs, activeTabId: prior.activeTabId, studioPluginSurfaces: prior.studioPluginSurfaces })
})
