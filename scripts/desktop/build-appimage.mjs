import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') {
  throw new Error('build-appimage.mjs is Linux-only')
}

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const binary = join(root, 'build', 'bin', 'studio')
const icon = join(root, 'build', 'appicon.png')
const appDir = join(root, 'build', 'appimage', 'Liapoldus Studio.AppDir')
const output = join(root, 'build', 'bin', 'Liapoldus-Studio-x86_64.AppImage')
const tool = process.env.APPIMAGETOOL
const runtime = process.env.APPIMAGETOOL_RUNTIME_FILE

if (!tool) throw new Error('APPIMAGETOOL must point to the pinned appimagetool binary')
if (!runtime) throw new Error('APPIMAGETOOL_RUNTIME_FILE must point to the pinned AppImage runtime')

await rm(appDir, { recursive: true, force: true })
await mkdir(join(appDir, 'usr', 'bin'), { recursive: true })
await mkdir(join(appDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps'), { recursive: true })
await cp(binary, join(appDir, 'usr', 'bin', 'studio'))
await cp(icon, join(appDir, 'liapoldus-studio.png'))
await cp(icon, join(appDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps', 'liapoldus-studio.png'))
await writeFile(join(appDir, 'liapoldus-studio.desktop'), `[Desktop Entry]\nType=Application\nName=Liapoldus Studio\nExec=studio\nIcon=liapoldus-studio\nCategories=Development;IDE;\nTerminal=false\n`, { mode: 0o644 })
const appRun = join(appDir, 'AppRun')
await writeFile(appRun, '#!/bin/sh\nset -eu\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$HERE/usr/bin/studio" "$@"\n', { mode: 0o755 })
await chmod(appRun, 0o755)

execFileSync(tool, ['--runtime-file', runtime, appDir, output], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ARCH: 'x86_64', APPIMAGE_EXTRACT_AND_RUN: '1' },
})
await chmod(output, 0o755)
console.log(`Linux AppImage: PASS (${output})`)
