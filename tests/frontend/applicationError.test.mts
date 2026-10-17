import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { text } from '../../frontend/src/models/copy.ts'

await test('application renderer fallback is localized and does not expose exception contents', async () => {
  assert.notEqual(text.ru.applicationErrorTitle, text.en.applicationErrorTitle)
  assert.notEqual(text.ru.applicationErrorBody, text.en.applicationErrorBody)
  assert.notEqual(text.ru.applicationErrorReload, text.en.applicationErrorReload)

  const mainSource = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/src/main.tsx'), 'utf8')
  assert.match(mainSource, /text\[useStudioStore\.getState\(\)\.locale\]/u)
  assert.match(mainSource, /copy\.applicationErrorTitle/u)
  assert.match(mainSource, /copy\.applicationErrorBody/u)
  assert.doesNotMatch(mainSource, /this\.state\.error\.message/u)
})
