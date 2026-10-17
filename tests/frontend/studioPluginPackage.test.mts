import assert from 'node:assert/strict'
import test from 'node:test'
import { groupStudioPluginVersions, parseInstalledStudioPluginInspections, parseStudioPluginInspection } from '../../frontend/src/models/studioPluginPackage.ts'

const digest = `sha256:${'a'.repeat(64)}`
const inspection = {
  manifest: {
    id: 'liapoldus.server-editor', name: 'Server Editor', version: '1.2.0', studioRange: '>=0.1.0',
    signature: 'ed25519:private-signature-is-not-rendered',
    permissions: ['service.settings.read', 'service.settings.write'],
    surfaces: [{ id: 'server-editor', kind: 'page', title: 'Server', route: 'ui/index.html' }],
    tools: [{ id: 'server.migrate', executable: '/private/path/never-render-this' }],
  },
  digest,
  signed: true,
  files: ['/private/path/never-render-this'],
}

await test('Studio plugin preview exposes safe summary and omits package paths and signature data', () => {
  const parsed = parseStudioPluginInspection(JSON.stringify(inspection))
  assert.deepEqual(parsed, {
    id: 'liapoldus.server-editor', name: 'Server Editor', version: '1.2.0', studioRange: '>=0.1.0', digest, signed: true,
    permissions: ['service.settings.read', 'service.settings.write'], grantedPermissions: [],
    surfaces: [{ id: 'server-editor', kind: 'page', context: 'workspace', title: 'Server', route: 'ui/index.html' }], toolIds: ['server.migrate'],
  })
  assert.equal(JSON.stringify(parsed).includes('/private/path'), false)
  assert.equal(JSON.stringify(parsed).includes('ed25519'), false)
})

await test('installed Studio plugin inspection list is bounded and parsed safely', () => {
  const parsed = parseInstalledStudioPluginInspections(JSON.stringify([{ ...inspection, grantedPermissions: ['service.settings.read'] }]))
  assert.equal(parsed[0]?.grantedPermissions[0], 'service.settings.read')
  assert.throws(() => parseInstalledStudioPluginInspections('{}'))
})

await test('installed plugin versions are grouped by id and semver latest is selected first', () => {
  const versions = ['0.3.16', '0.3.27', '0.3.29', '0.3.29-beta.1'].map((version) => parseStudioPluginInspection(JSON.stringify({
    ...inspection,
    manifest: { ...inspection.manifest, version },
  })))
  const groups = groupStudioPluginVersions(versions)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.current.version, '0.3.29')
  assert.deepEqual(groups[0]?.previous.map((plugin) => plugin.version), ['0.3.29-beta.1', '0.3.27', '0.3.16'])
})

await test('installed plugin version grouping never duplicates a version', () => {
  const plugin = parseStudioPluginInspection(JSON.stringify(inspection))
  const groups = groupStudioPluginVersions([plugin, plugin])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.previous.length, 0)
})

await test('preview preserves declared command surfaces without treating them as navigable pages', () => {
  const value = { ...inspection, manifest: { ...inspection.manifest, surfaces: [{ id: 'compile', kind: 'command', title: 'Compile' }] } }
  assert.deepEqual(parseStudioPluginInspection(JSON.stringify(value)).surfaces, [{ id: 'compile', kind: 'command', context: 'workspace', title: 'Compile', route: '' }])
})

await test('Studio plugin inspection rejects invalid digests, traversal routes and duplicate permissions', () => {
  assert.throws(() => parseStudioPluginInspection(JSON.stringify({ ...inspection, digest: 'sha256:bad' })))
  assert.throws(() => parseStudioPluginInspection(JSON.stringify({ ...inspection, manifest: { ...inspection.manifest, surfaces: [{ id: 'unsafe', kind: 'page', title: 'Unsafe', route: '../manifest.json' }] } })))
  assert.throws(() => parseStudioPluginInspection(JSON.stringify({ ...inspection, manifest: { ...inspection.manifest, permissions: ['project.read', 'project.read'] } })))
})
