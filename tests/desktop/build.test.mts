import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopBuildArgs } from '../../scripts/desktop/build.mts'

await test('Linux desktop builds use the installed WebKit2GTK 4.1 ABI', () => {
  const args = desktopBuildArgs({ platform: 'linux', wailsPlatform: 'linux/amd64' })
  assert.deepEqual(args, ['build', '-m', '-nosyncgomod', '-platform', 'linux/amd64', '-tags', 'webkit2_41'])
})

await test('non-Linux desktop builds do not receive Linux WebKit tags', () => {
  const args = desktopBuildArgs({ platform: 'darwin', release: true })
  assert.deepEqual(args, [
    'build', '-m', '-nosyncgomod',
    '-ldflags', '-X github.com/Liapoldus/studio/internal/infrastructure/config.ReleaseBuild=true',
  ])
})

await test('desktop builds can reuse an already-built frontend', () => {
  const args = desktopBuildArgs({ platform: 'win32', skipFrontend: true })
  assert.deepEqual(args, ['build', '-m', '-nosyncgomod', '-s'])
})
