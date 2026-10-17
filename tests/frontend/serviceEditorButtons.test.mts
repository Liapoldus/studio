import assert from 'node:assert/strict'
import test from 'node:test'
import { assignSingleServiceEditorPages, parseServiceEditorButtons, resolveServiceEditorButtons, serviceInspectorHiddenSettingsPaths, serviceInspectorPathIsHidden } from '../../frontend/src/models/serviceEditorButtons.ts'

const manifest = JSON.stringify({
  id: 'server',
  editorButtons: { version: 'service-editor-buttons/v1', buttons: [{
    id: 'server.endpoints', key: 'endpoints', label: { ru: 'Эндпоинты', en: 'Endpoints' }, description: { ru: 'Открыть редактор', en: 'Open editor' },
  }] },
})

await test('parses stable service editor button declarations', () => {
  assert.deepEqual(parseServiceEditorButtons(manifest, 'server'), [{
    id: 'server.endpoints', key: 'endpoints', label: { ru: 'Эндпоинты', en: 'Endpoints' }, description: { ru: 'Открыть редактор', en: 'Open editor' },
  }])
})

await test('rejects mismatched service namespace, missing locale, duplicate and unsupported versions', () => {
  assert.deepEqual(parseServiceEditorButtons(manifest, 'echo'), [])
  for (const descriptor of [
    { version: 'service-editor-buttons/v2', buttons: [] },
    { version: 'service-editor-buttons/v1', buttons: [{ id: 'other.endpoints', key: 'endpoints', label: { ru: 'x', en: 'x' }, description: { ru: 'x', en: 'x' } }] },
    { version: 'service-editor-buttons/v1', buttons: [{ id: 'server.endpoints', key: 'endpoints', label: { ru: 'x' }, description: { ru: 'x', en: 'x' } }] },
    { version: 'service-editor-buttons/v1', callback: 'execute()', buttons: [{ id: 'server.endpoints', key: 'endpoints', label: { ru: 'x', en: 'x' }, description: { ru: 'x', en: 'x' } }] },
  ]) assert.deepEqual(parseServiceEditorButtons(JSON.stringify({ id: 'server', editorButtons: descriptor }), 'server'), [])
})

await test('shows a button only for its installed service-context surface', () => {
  const buttons = parseServiceEditorButtons(manifest, 'server')
  const bindings = [{ buttonId: 'server.endpoints', pluginId: 'liapoldus.server-editor', surfaceId: 'server-editor' }]
  const workspaceSurface = { studioPluginId: 'liapoldus.server-editor', id: 'server-editor', context: 'workspace' as const }
  assert.deepEqual(resolveServiceEditorButtons(buttons, bindings, [workspaceSurface]), [])
  const serviceSurface = { ...workspaceSurface, context: 'service' as const }
  assert.equal(resolveServiceEditorButtons(buttons, bindings, [serviceSurface]).length, 1)
  assert.deepEqual(resolveServiceEditorButtons(buttons, bindings, []), [])
})

await test('auto-assigns the only plugin with one service page and preserves existing choices', () => {
  const buttons = [{ id: 'server.endpoints' }]
  const onlyPage = [{ studioPluginId: 'liapoldus.server-editor', id: 'server-editor', context: 'service' as const }]
  assert.deepEqual(assignSingleServiceEditorPages(buttons, [], onlyPage), [{ buttonId: 'server.endpoints', pluginId: 'liapoldus.server-editor', surfaceId: 'server-editor' }])
  assert.deepEqual(assignSingleServiceEditorPages(buttons, [{ buttonId: 'server.endpoints', pluginId: 'custom.editor', surfaceId: 'custom-page' }], onlyPage), [{ buttonId: 'server.endpoints', pluginId: 'custom.editor', surfaceId: 'custom-page' }])
  assert.deepEqual(assignSingleServiceEditorPages(buttons, [], [...onlyPage, { studioPluginId: 'liapoldus.server-editor', id: 'other-page', context: 'service' as const }]), [])
  assert.deepEqual(assignSingleServiceEditorPages(buttons, [], [...onlyPage, { studioPluginId: 'other.editor', id: 'other-page', context: 'service' as const }]), [])
  assert.deepEqual(assignSingleServiceEditorPages(buttons, [], [{ studioPluginId: 'workspace.editor', id: 'workspace', context: 'workspace' as const }]), [])
})

await test('keeps Server endpoint settings inside the Server editor surface', () => {
  assert.deepEqual(serviceInspectorHiddenSettingsPaths('server'), ['/config/routes', '/config/listeners'])
  assert.deepEqual(serviceInspectorHiddenSettingsPaths('echo'), [])
  assert.equal(serviceInspectorPathIsHidden('server', ['config', 'routes']), true)
  assert.equal(serviceInspectorPathIsHidden('server', ['config', 'routes', '0', 'path']), true)
  assert.equal(serviceInspectorPathIsHidden('server', ['config', 'listeners', '0', 'address']), true)
  assert.equal(serviceInspectorPathIsHidden('server', ['config', 'timeouts', 'read']), false)
  assert.equal(serviceInspectorPathIsHidden('echo', ['config', 'routes', '0', 'path']), false)
})
