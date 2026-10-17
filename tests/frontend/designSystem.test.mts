import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend')
const brandRoot = join(frontendRoot, 'src/assets/brand')

await test('studio keeps only the user-supplied logo and uses Lucide for UI icons', async () => {
  const manifest = JSON.parse(await readFile(join(brandRoot, 'design-system.json'), 'utf8')) as {
    distribution: string
    contentSha256: string
  }
  assert.equal(manifest.distribution, 'brand-mark-only')
  assert.match(manifest.contentSha256, /^[0-9a-f]{64}$/u)

  const logo = await readFile(join(brandRoot, 'logo/liapoldus-mark.svg'), 'utf8')
  assert.match(logo, /viewBox="0 0 966 1033"/u)
  assert.match(logo, /fill="#FC5D15"/u)
  const assets = await readdir(brandRoot, { recursive: true })
  assert.deepEqual(assets.filter((path) => path.endsWith('.svg')), ['logo/liapoldus-mark.svg'])

  const packageJson = JSON.parse(await readFile(join(frontendRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  assert.ok(packageJson.dependencies['lucide-react'])

  const sources = ['src/App.css', 'src/style.css', 'src/ui/BrandMark.tsx']
  const referenced = new Set<string>()
  for (const source of sources) {
    const contents = await readFile(join(frontendRoot, source), 'utf8')
    for (const match of contents.matchAll(/assets\/brand\/([\w./-]+)/gu)) referenced.add(match[1])
  }
  for (const relative of referenced) await access(join(brandRoot, relative))
  const appCSS = await readFile(join(frontendRoot, 'src/App.css'), 'utf8')
  const themeCSS = await readFile(join(brandRoot, 'tokens.css'), 'utf8')
  for (const [source, css] of [['App.css', appCSS], ['tokens.css', themeCSS]] as const) {
    for (const [, raw] of css.matchAll(/#([0-9a-f]{3,8})/giu)) {
      const hex = raw.length === 3 ? Array.from(raw, (digit) => `${digit}${digit}`).join('') : raw.slice(0, 6)
      assert.equal(hex.slice(0, 2), hex.slice(2, 4), `${source} contains chromatic red in #${raw}`)
      assert.equal(hex.slice(2, 4), hex.slice(4, 6), `${source} contains chromatic blue in #${raw}`)
    }
  }
  assert.doesNotMatch(appCSS, /\.bottom-dock|\.dock-content|\.cm-editor/u)
})
