import assert from 'node:assert/strict'
import test from 'node:test'
import { isStudioPluginSurfaceReadyMessage, parseStudioPluginBridgeRequest, studioPluginBridgeFailureCode, studioPluginPermissionGranted, studioPluginSurfaceAssetURL, withPeerCatalogDeadline } from '../../frontend/src/models/pluginSurface.ts'
import { latestStudioPluginSurfaces } from '../../frontend/src/models/studioPluginPackage.ts'

await test('plugin surface URLs accept only relative HTML routes and encode each segment', () => {
  const tab = { kind: 'studio-plugin', studioPluginId: 'tools.compiler', studioPluginVersion: '1.2.0-beta', surfaceId: 'logs', route: 'ui/index.html' }
  assert.equal(studioPluginSurfaceAssetURL(tab), '/studio-plugin-assets/tools.compiler/1.2.0-beta/logs/ui/index.html')
  for (const route of ['/ui/index.html', '../index.html', 'ui/../index.html', 'ui\\index.html', 'ui/app.js', 'ui/index.html?source=remote', 'ui//index.html']) {
    assert.equal(studioPluginSurfaceAssetURL({ ...tab, route }), null, `accepted route ${route}`)
  }
  assert.equal(studioPluginSurfaceAssetURL({ ...tab, studioPluginId: '../escape' }), null)
})

await test('plugin surface bridge accepts only the versioned ready message shape', () => {
  const ready = { type: 'studio.surface.ready', schemaVersion: 'studio-service-editor/v1', sessionId: 'a'.repeat(32) }
  assert.equal(isStudioPluginSurfaceReadyMessage(ready), true)
  assert.equal(isStudioPluginSurfaceReadyMessage(ready, 'b'.repeat(32)), false)
  assert.equal(isStudioPluginSurfaceReadyMessage({ ...ready, payload: { token: 'secret' } }), false)
  assert.equal(isStudioPluginSurfaceReadyMessage({ type: 'studio.host.ready', schemaVersion: 'studio-service-editor/v1', sessionId: 'a'.repeat(32) }), false)
  assert.equal(isStudioPluginSurfaceReadyMessage(null), false)
  assert.equal(isStudioPluginSurfaceReadyMessage([]), false)
})

await test('plugin bridge requests are bounded, versioned and reject unsafe scopes', () => {
  const base = { type: 'studio.bridge.request', schemaVersion: 'studio-service-editor/v1', sessionId: 'a'.repeat(32), requestId: 'req-1' }
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'context.get' })?.method, 'context.get')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.configuration-ui.read' })?.method, 'service.configuration-ui.read')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.configuration-ui.read', payload: {} }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.list', payload: { resourceId: 'sites' } })?.method, 'service.resource.list')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.list', payload: { resourceId: '../sites' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.list', payload: { resourceId: 'sites', endpoint: 'https://service' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.admin-surface.read' })?.method, 'service.admin-surface.read')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.admin-surface.read', payload: {} }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.artifact.select' })?.method, 'service.resource.artifact.select')
  const publish = { pageId: 'sites', actionId: 'publish', artifactPath: 'resources/site.tar.gz', contentType: 'application/gzip', metadata: { siteId: 'docs' }, ifMatch: 'revision-1' }
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.publish', payload: publish })?.method, 'service.resource.publish')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.publish', payload: { ...publish, artifactPath: '../outside.tar.gz' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.publish', payload: { ...publish, metadata: { apiToken: 'secret' } } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.operation.watch', payload: { operationId: 'operation-1' } })?.method, 'service.resource.operation.watch')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.operation.watch', payload: { operationId: '../other' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.resource.operation.watch', payload: { operationId: 'operation-1', target: 'remote' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.peer.catalog.read' })?.method, 'service.peer.catalog.read')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.peer.catalog.read', payload: { targetServiceId: 'echo' } })?.method, 'service.peer.catalog.read')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.peer.catalog.read', payload: { targetServiceId: '../echo' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.peer.catalog.read', payload: { targetServiceId: 'echo', endpoint: 'https://service' } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.settings.patch', payload: { path: ['__proto__'], value: true } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.settings.patch', payload: { path: ['settings', 'port'], value: 8080 } })?.method, 'service.settings.patch')
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.settings.patch', payload: { path: [], value: true } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'context.get', payload: { path: ['unscoped'] } }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.settings.patch', extra: true }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, method: 'service.settings.apply' }), null)
  assert.equal(parseStudioPluginBridgeRequest({ ...base, sessionId: '../unsafe', method: 'context.get' }), null)
})

await test('configuration UI metadata requires its own declared and granted permission', () => {
  const settingsOnly = ['service.settings.read', 'service.settings.write']
  assert.equal(studioPluginPermissionGranted(settingsOnly, settingsOnly, 'service.settings.read'), true)
  assert.equal(studioPluginPermissionGranted(settingsOnly, settingsOnly, 'service.configuration-ui.read'), false)
  const declared = [...settingsOnly, 'service.configuration-ui.read']
  assert.equal(studioPluginPermissionGranted(declared, settingsOnly, 'service.configuration-ui.read'), false)
  assert.equal(studioPluginPermissionGranted(declared, declared, 'service.configuration-ui.read'), true)
  assert.equal(studioPluginPermissionGranted(new Set(declared), new Set(declared), 'service.configuration-ui.read'), true)
})

await test('peer catalog access requires its own explicit declaration and grant', () => {
  const declared = ['service.settings.read', 'service.peer.catalog.read']
  assert.equal(studioPluginPermissionGranted(declared, declared, 'service.peer.catalog.read'), true)
  assert.equal(studioPluginPermissionGranted(['service.settings.read'], declared, 'service.peer.catalog.read'), false)
  assert.equal(studioPluginPermissionGranted(declared, ['service.settings.read'], 'service.peer.catalog.read'), false)
})

await test('plugin host preserves only safe typed CLI failure codes', () => {
  assert.equal(studioPluginBridgeFailureCode(new Error('bridge.permission_denied'), 'bridge.fallback'), 'bridge.permission_denied')
  assert.equal(studioPluginBridgeFailureCode(new Error('liapoldus: core.management_unavailable: private endpoint'), 'bridge.fallback'), 'bridge.cli.core.management_unavailable')
  assert.equal(studioPluginBridgeFailureCode(new Error('liapoldus: cli.exit: token=secret'), 'bridge.fallback'), 'bridge.cli.cli.exit')
  assert.equal(studioPluginBridgeFailureCode(new Error('arbitrary path /Users/alice'), 'bridge.fallback'), 'bridge.fallback')
  assert.equal(studioPluginBridgeFailureCode(new Error('liapoldus: invalid code\nsecret'), 'bridge.fallback'), 'bridge.fallback')
  assert.equal(studioPluginBridgeFailureCode(new Error('anything'), 'untrusted-fallback'), 'bridge.operation_failed')
})

await test('peer catalog host deadline returns a typed timeout when a WebView request never settles', async () => {
  await assert.rejects(withPeerCatalogDeadline(new Promise(() => undefined), 1), /bridge.peer_catalog_timeout/u)
  assert.deepEqual(await withPeerCatalogDeadline(Promise.resolve({ methods: [{ id: 'echo.handle', version: '1.0.0' }] }), 100), {
    methods: [{ id: 'echo.handle', version: '1.0.0' }],
  })
})

await test('only the latest installed version contributes a plugin navigation surface', () => {
  const surfaces = [
    { studioPluginId: 'server.editor', version: '0.3.16', id: 'server', title: 'Server', route: 'ui/index.html' },
    { studioPluginId: 'server.editor', version: '0.3.27', id: 'server', title: 'Server', route: 'ui/index.html' },
    { studioPluginId: 'server.editor', version: '0.3.29', id: 'server', title: 'Server', route: 'ui/index.html' },
    { studioPluginId: 'other.editor', version: '1.0.0', id: 'other', title: 'Other', route: 'ui/index.html' },
  ]
  assert.deepEqual(latestStudioPluginSurfaces(surfaces).map(({ studioPluginId, version }) => [studioPluginId, version]), [
    ['server.editor', '0.3.29'], ['other.editor', '1.0.0'],
  ])
})
