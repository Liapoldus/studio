import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const platform = process.env.STUDIO_PACKAGE_PLATFORM
const bin = join('build', 'bin')
if (!platform || !['darwin', 'windows', 'linux'].includes(platform)) {
  throw new Error(`Unsupported provenance platform: ${platform ?? '<missing>'}`)
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else result.push(path)
  }
  return result.sort()
}

const sourceRevision = process.env.GITHUB_SHA?.trim() || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const artifacts = []
for (const path of await files(bin)) {
  const data = await readFile(path)
  const metadata = await stat(path)
  artifacts.push({
    path: relative(bin, path).replaceAll('\\', '/'),
    size: metadata.size,
    sha256: createHash('sha256').update(data).digest('hex'),
  })
}

const provenance = {
  schemaVersion: 'studio-build-provenance/v1',
  sourceRevision,
  platform,
  signed: process.env.STUDIO_RELEASE_SIGNED === 'true',
  artifacts,
}
await writeFile(join(bin, `provenance-${platform}.json`), `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 })
console.log(`Build provenance: PASS (${platform}, ${artifacts.length} artifacts)`)
