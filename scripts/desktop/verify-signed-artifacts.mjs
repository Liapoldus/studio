import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const platform = process.env.STUDIO_PACKAGE_PLATFORM
const bin = join('build', 'bin')

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

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

const artifacts = await files(bin)
if (platform === 'darwin') {
  const app = join(bin, 'Liapoldus Studio.app')
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  run('xcrun', ['stapler', 'validate', app])
  console.log('Signed artifact verification: PASS (macOS codesign + notarization staple)')
} else if (platform === 'windows') {
  const executables = artifacts.filter((path) => path.toLowerCase().endsWith('.exe'))
  if (executables.length === 0) throw new Error('Windows signed package has no executable')
  for (const executable of executables) {
    run('signtool.exe', ['verify', '/pa', '/all', executable])
  }
  console.log(`Signed artifact verification: PASS (Windows Authenticode, ${executables.length} executables)`)
} else if (platform === 'linux') {
  const appImage = artifacts.some((path) => path.toLowerCase().endsWith('.appimage'))
  const executable = artifacts.some((path) => path.endsWith('/studio'))
  if (!appImage || !executable) throw new Error('Linux production package must contain both an AppImage and the native executable')
  console.log('Signed artifact verification: PASS (Linux package structure; checksum/provenance provide artifact identity)')
} else {
  throw new Error(`Unsupported signed artifact platform: ${platform ?? '<missing>'}`)
}
