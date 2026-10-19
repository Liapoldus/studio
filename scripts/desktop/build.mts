import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepareBindings } from '../bindings/prepare.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export type DesktopBuildOptions = {
  platform: NodeJS.Platform
  wailsPlatform?: string
  nsis?: boolean
  release?: boolean
}

export function desktopBuildArgs(options: DesktopBuildOptions): string[] {
  const args = ['build', '-m', '-nosyncgomod']
  if (options.wailsPlatform) args.push('-platform', options.wailsPlatform)
  if (options.platform === 'linux') args.push('-tags', 'webkit2_41')
  if (options.nsis) args.push('-nsis')
  if (options.release) args.push('-ldflags', '-X github.com/Liapoldus/studio/internal/infrastructure/config.ReleaseBuild=true')
  return args
}

async function buildDesktop(): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), 'studio-build-'))
  try {
    const platform = process.platform
    const wailsArgs = desktopBuildArgs({
      platform,
      wailsPlatform: process.env.STUDIO_WAILS_PLATFORM,
      nsis: process.env.STUDIO_WAILS_NSIS === 'true',
      release: process.env.STUDIO_RELEASE_BUILD === 'true',
    })
    if (platform === 'win32') {
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
    if (platform === 'win32') {
      await mkdir(join(root, 'build/bin'), { recursive: true })
      await copyFile(join(root, 'build/sandbox/studio-sandbox-launcher.exe'), join(root, 'build/bin/studio-sandbox-launcher.exe'))
    }
    // Wails copies runtime declarations again after the frontend build hook.
    await prepareBindings(join(root, 'frontend/wailsjs'))
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildDesktop()
}
