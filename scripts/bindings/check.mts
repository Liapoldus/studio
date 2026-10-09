import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBindings } from './prepare.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function snapshot(path: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name)
    if (entry.isDirectory()) {
      for (const [name, value] of Object.entries(await snapshot(target))) {
        files[`${entry.name}/${name}`] = value
      }
    } else {
      files[entry.name] = createHash('sha256').update(await readFile(target)).digest('hex')
    }
  }
  return files
}

const version = execFileSync('wails', ['version'], { encoding: 'utf8' })
assert.match(version, /\bv2\.12\.0\b/u, 'Wails CLI must match go.mod: v2.12.0')
const expected = await snapshot(join(root, 'frontend/wailsjs'))
const sandbox = await mkdtemp(join(tmpdir(), 'studio-bindings-'))
try {
  // Generate in isolation: neither handwritten WIP nor the user's SQLite is touched.
  for (const name of ['go.mod', 'go.sum', 'main.go', 'wails.json', 'internal']) {
    await cp(join(root, name), join(sandbox, name), { recursive: true })
  }
  const env = { ...process.env, GOWORK: 'off', GOFLAGS: process.env.GOFLAGS ?? '-p=1', STUDIO_DESKTOP_DB_PATH: join(sandbox, 'client.sqlite') }
  for (let run = 0; run < 2; run++) {
    execFileSync('wails', ['generate', 'module'], { cwd: sandbox, env, stdio: 'inherit' })
    await prepareBindings(join(sandbox, 'frontend/wailsjs'))
    assert.deepEqual(await snapshot(join(sandbox, 'frontend/wailsjs')), expected,
      'Wails artifacts differ from canonical Go generation; regenerate and prepare bindings')
  }
  process.stdout.write('Wails generation reproducibility: PASS (two isolated runs)\n')
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
