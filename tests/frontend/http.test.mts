import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHTTPStudioAPI } from '../../frontend/src/api/http.ts'

await test('HTTP adapter validates same-origin product information', async (context) => {
  const value = { name: 'Studio', description: 'Shell', workspaceFeatures: ['project'] }
  context.mock.method(globalThis, 'fetch', (url: string, options: RequestInit) => {
    assert.equal(url, '/api/v1/product-info')
    assert.equal(options.credentials, 'same-origin')
    assert.deepEqual(options.headers, { Accept: 'application/json' })
    return Promise.resolve(Response.json(value))
  })
  assert.equal(JSON.stringify(await createHTTPStudioAPI().productInfo()), JSON.stringify(value))
})

await test('HTTP adapter rejects failed responses and malformed payloads', async (context) => {
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 503 })))
  await assert.rejects(createHTTPStudioAPI().productInfo(), /Не удалось загрузить/u)
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({ name: 'Studio' })))
  await assert.rejects(createHTTPStudioAPI().productInfo(), /Invalid Studio product information/u)
})
