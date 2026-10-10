import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  throw new Error('sandbox-smoke.mjs is Windows-only')
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const packageRoot = join(root, 'build', 'bin')
const helper = join(packageRoot, 'studio-sandbox-launcher.exe')
const probe = join(packageRoot, 'studio-sandbox-probe.exe')
const projectRoot = await mkdtemp(join(tmpdir(), 'studio-sandbox-project-'))
const outsideRoot = await mkdtemp(join(tmpdir(), 'studio-sandbox-outside-'))

try {
  await access(helper)
  execFileSync('go', ['build', '-o', probe, './cmd/sandbox-probe'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, GOWORK: 'off', GOFLAGS: process.env.GOFLAGS ?? '-p=1' },
  })
  execFileSync(helper, [
    '--package-root', packageRoot,
    '--project-root', projectRoot,
    '--write-project', 'true',
    '--network', 'false',
    '--', probe, projectRoot, outsideRoot,
  ], { cwd: projectRoot, stdio: 'inherit' })
  await access(join(projectRoot, 'allowed.txt'))
  await readFile(join(projectRoot, 'allowed.txt'), 'utf8')
  try {
    await access(join(outsideRoot, 'denied.txt'))
    throw new Error('sandbox smoke detected an outside write')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  console.log('Windows AppContainer sandbox smoke: PASS')
} finally {
  await rm(probe, { force: true })
  await rm(projectRoot, { recursive: true, force: true })
  await rm(outsideRoot, { recursive: true, force: true })
}
