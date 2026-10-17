import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

await test('global plugin settings expose assignments outside the conditional installed cards', async () => {
  const source = await readFile(new URL('../../frontend/src/views/StudioPluginsView.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('<section className="settings-section plugin-editor-bindings"')
  const end = source.indexOf('<section className="settings-section plugin-installed"')
  assert.ok(start > 0 && end > start)
  const markup = source.slice(start, end)
  assert.match(markup, /Редакторы сервисов/u)
  assert.match(markup, /Откройте проект/u)
  assert.match(markup, /Назначение действует во всей Studio/u)
  assert.match(markup, /aria-labelledby="service-editor-bindings-title"/u)
  assert.match(markup, /buttonCandidates.length === 0/u)
  assert.match(markup, /Назначенная страница недоступна/u)
  assert.match(markup, /Снять назначение/u)
})
