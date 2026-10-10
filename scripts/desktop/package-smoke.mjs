import { access, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const bin = join(root, 'build', 'bin')
const platform = process.env.STUDIO_PACKAGE_PLATFORM

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else result.push(path)
  }
  return result
}

const artifacts = await files(bin)
if (artifacts.length === 0) throw new Error('Wails package produced no artifacts')

if (platform === 'darwin') {
  await access(join(bin, 'Liapoldus Studio.app', 'Contents', 'MacOS', 'studio'))
} else if (platform === 'windows') {
  if (!artifacts.some((path) => path.toLowerCase().endsWith('.exe'))) throw new Error('Windows package has no executable')
  if (!artifacts.some((path) => path.toLowerCase().endsWith('studio-sandbox-launcher.exe'))) throw new Error('Windows package has no AppContainer sandbox launcher')
} else if (platform === 'linux') {
  if (!artifacts.some((path) => path.toLowerCase().endsWith('.appimage') || path.endsWith('/studio'))) throw new Error('Linux package has no executable or AppImage')
} else {
  throw new Error(`Unsupported package smoke platform: ${platform ?? '<missing>'}`)
}

console.log(`Desktop package smoke: PASS (${platform}, ${artifacts.length} files)`)
