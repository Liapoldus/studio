import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBindings } from '../bindings/prepare.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sandbox = await mkdtemp(join(tmpdir(), 'studio-build-'))
try {
  execFileSync('wails', ['build', '-m', '-nosyncgomod'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, GOWORK: 'off', GOFLAGS: process.env.GOFLAGS ?? '-p=1', STUDIO_DESKTOP_DB_PATH: join(sandbox, 'client.sqlite') },
  })
  // Wails copies runtime declarations again after the frontend build hook.
  await prepareBindings(join(root, 'frontend/wailsjs'))
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
