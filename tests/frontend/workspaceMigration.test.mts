import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { migrateWorkspace } from '../../scripts/workspace/migrate.mts'

await test('project-local migration previews, checks revision and recovers exact user bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-workspace-migration-'))
  try {
    await mkdir(join(root, '.studio'))
    const path = join(root, '.studio', 'workspace.json')
    const original = Buffer.from('{\n"layout":{"nodes":{"neutral-id":{"x":12,"y":34}}},"filters":{"mine":true},"tabs":{"schemaVersion":"workspace/v3","tabs":[{"id":"plugins","kind":"plugins","title":"Extensions","extra":"keep"}],"activeTabId":"plugins","layout":{"neutral-id":{"x":12,"y":34}},"custom":"keep"},"opaque":"keep"\n}\n')
    await writeFile(path, original)
    const preview = await migrateWorkspace({ projectRoot: root })
    assert.equal(preview.digest, createHash('sha256').update(original).digest('hex'))
    assert.equal(preview.changed, true)
    assert.deepEqual(await readFile(path), original)
    await assert.rejects(migrateWorkspace({ projectRoot: root, mode: 'apply', expectedDigest: 'stale' }), /changed since preview/u)
    await migrateWorkspace({ projectRoot: root, mode: 'apply', expectedDigest: preview.digest })
    assert.deepEqual(await readFile(preview.recoveryPath), original)
    const next = await migrateWorkspace({ projectRoot: root })
    assert.equal(next.changed, false)
    const migrated: unknown = JSON.parse(await readFile(path, 'utf8'))
    const expected: unknown = JSON.parse(original.toString('utf8').replace('workspace/v3', 'workspace/v4').replaceAll('"plugins"', '"studio-plugins"'))
    assert.deepEqual(migrated, expected)
    await migrateWorkspace({ projectRoot: root, mode: 'recover', expectedDigest: next.digest, recoveryDigest: preview.digest })
    assert.deepEqual(await readFile(path), original)
  } finally { await rm(root, { recursive: true, force: true }) }
})

await test('migration refuses symlinked state and unsupported versions without mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-workspace-migration-'))
  try {
    await mkdir(join(root, '.studio'))
    const outside = join(root, 'user.json')
    const original = '{"tabs":{"schemaVersion":"workspace/v99","tabs":[]}}'
    await writeFile(outside, original)
    await symlink(outside, join(root, '.studio', 'workspace.json'))
    await assert.rejects(migrateWorkspace({ projectRoot: root }), /regular file/u)
    assert.equal(await readFile(outside, 'utf8'), original)
    await rm(join(root, '.studio', 'workspace.json'))
    await writeFile(join(root, '.studio', 'workspace.json'), original)
    await assert.rejects(migrateWorkspace({ projectRoot: root }), /Unsupported workspace/u)
    assert.equal(await readFile(join(root, '.studio', 'workspace.json'), 'utf8'), original)
  } finally { await rm(root, { recursive: true, force: true }) }
})
