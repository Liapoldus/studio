import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { previewWorkspaceMigration } from '../../frontend/src/models/studio.ts'

const digestOf = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
type Options = { projectRoot: string; mode?: 'preview' | 'apply' | 'recover'; expectedDigest?: string; recoveryDigest?: string }

async function regularFile(path: string): Promise<Buffer> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Workspace state must be a regular file')
  return readFile(path)
}

async function preserve(path: string, data: Buffer) {
  try { await writeFile(path, data, { flag: 'wx', mode: 0o600 }) }
  catch (reason: unknown) {
    if (!(reason instanceof Error) || !('code' in reason) || reason.code !== 'EEXIST') throw reason
    if (!(await regularFile(path)).equals(data)) throw new Error('Recovery snapshot does not match its digest')
  }
}

// Studio-owned state only. Project manifests, services, generation bytes and
// historical reports are never opened for writing by this migration.
export async function migrateWorkspace(options: Options) {
  if (!isAbsolute(options.projectRoot)) throw new Error('An absolute project root is required')
  const root = await realpath(options.projectRoot)
  const directory = join(root, '.studio')
  const directoryInfo = await lstat(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Workspace directory must not be a symlink')
  const path = join(directory, 'workspace.json')
  const before = await regularFile(path)
  const digest = digestOf(before)
  const mode = options.mode ?? 'preview'
  let after: Buffer
  if (mode === 'recover') {
    if (!options.recoveryDigest || !/^[a-f0-9]{64}$/u.test(options.recoveryDigest)) throw new Error('A valid recovery digest is required')
    after = await regularFile(join(directory, `workspace-recovery-${options.recoveryDigest}.json`))
    if (digestOf(after) !== options.recoveryDigest) throw new Error('Recovery snapshot does not match its digest')
    JSON.parse(after.toString('utf8')) as unknown
  } else {
    const document: unknown = JSON.parse(before.toString('utf8'))
    if (typeof document !== 'object' || document === null || Array.isArray(document) || !('tabs' in document)) throw new Error('Invalid workspace document')
    const preview = previewWorkspaceMigration(JSON.stringify(document.tabs))
    after = preview.changed ? Buffer.from(JSON.stringify({ ...document, tabs: JSON.parse(preview.after) as unknown }, null, 2) + '\n') : before
  }
  const changed = !before.equals(after)
  const result = { schemaVersion: 'studio-workspace-migration/v1', path, digest, nextDigest: digestOf(after), changed, recoveryPath: join(directory, `workspace-recovery-${digest}.json`) }
  if (mode === 'preview') return result
  if (options.expectedDigest !== digest) throw new Error('Workspace changed since preview; preview again before writing')
  if (!changed) return result
  await preserve(result.recoveryPath, before)
  const temporary = join(directory, `.workspace-migration-${randomUUID()}`)
  try {
    await writeFile(temporary, after, { flag: 'wx', mode: 0o600 })
    if (!(await regularFile(path)).equals(before)) throw new Error('Workspace changed while migrating; no state was replaced')
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((reason: unknown) => {
      if (!(reason instanceof Error) || !('code' in reason) || reason.code !== 'ENOENT') throw reason
    })
  }
  return result
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [projectRoot, mode = 'preview', expectedDigest, recoveryDigest] = process.argv.slice(2)
  if (!projectRoot || !['preview', 'apply', 'recover'].includes(mode)) throw new Error('Usage: migrate.mts /absolute/project preview|apply|recover [expected-digest] [recovery-digest]')
  const result = await migrateWorkspace({ projectRoot, mode: mode as 'preview' | 'apply' | 'recover', expectedDigest, recoveryDigest })
  process.stdout.write(JSON.stringify({ ...result, projectRoot: dirname(dirname(result.path)) }, null, 2) + '\n')
}
