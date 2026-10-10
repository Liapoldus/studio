import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBindings } from '../bindings/prepare.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sandbox = await mkdtemp(join(tmpdir(), 'studio-build-'))
try {
  const wailsArgs = ['build', '-m', '-nosyncgomod']
  if (process.env.STUDIO_WAILS_PLATFORM) {
    wailsArgs.push('-platform', process.env.STUDIO_WAILS_PLATFORM)
  }
  if (process.env.STUDIO_WAILS_NSIS === 'true') {
    wailsArgs.push('-nsis')
  }
  if (process.platform === 'win32') {
    const helperPath = join(root, 'build/sandbox/studio-sandbox-launcher.exe')
    await mkdir(join(root, 'build/sandbox'), { recursive: true })
    await mkdir(join(root, 'build/windows/installer'), { recursive: true })
    await copyFile(join(root, 'scripts/desktop/windows-installer.nsi'), join(root, 'build/windows/installer/project.nsi'))
    execFileSync('go', ['build', '-o', helperPath, './cmd/sandbox-launcher'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, GOWORK: 'off', GOFLAGS: process.env.GOFLAGS ?? '-p=1' },
    })
  }
  execFileSync('wails', wailsArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, GOWORK: 'off', GOFLAGS: process.env.GOFLAGS ?? '-p=1', STUDIO_DESKTOP_DB_PATH: join(sandbox, 'client.sqlite') },
  })
  if (process.platform === 'win32') {
    await mkdir(join(root, 'build/bin'), { recursive: true })
    await copyFile(join(root, 'build/sandbox/studio-sandbox-launcher.exe'), join(root, 'build/bin/studio-sandbox-launcher.exe'))
  }
  // Wails copies runtime declarations again after the frontend build hook.
  await prepareBindings(join(root, 'frontend/wailsjs'))
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
