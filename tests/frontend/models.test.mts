import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductInfo, models } from '../../frontend/src/api/info.ts'
import { decodeWailsBytes } from '../../frontend/src/api/bytes.ts'
import { summarizeCLIEvent } from '../../frontend/src/models/studio.ts'
import { parsePluginReadiness } from '../../frontend/src/models/runtime.ts'

await test('model preserves Wails factories and valid object/JSON payloads', () => {
  const value = { name: 'Studio', description: 'Shell', workspaceFeatures: ['project'] }
  assert.equal(models.ProductInfo, ProductInfo)
  assert.equal(JSON.stringify(new ProductInfo(value)), JSON.stringify(value))
  assert.equal(JSON.stringify(models.ProductInfo.createFrom(JSON.stringify(value))), JSON.stringify(value))
  const model = new ProductInfo(value)
  value.workspaceFeatures[0] = 'changed'
  assert.deepEqual(model.workspaceFeatures, ['project'])
  for (const invalid of [null, {}, { ...value, workspaceFeatures: [1] }]) {
    assert.throws(() => new ProductInfo(invalid), /Invalid Studio product information/u)
  }
})

await test('Wails byte responses decode both base64 and numeric-array payloads', () => {
  const expected = new TextEncoder().encode('{"statePath":"/tmp/core.sqlite"}')
  assert.deepEqual(decodeWailsBytes(btoa(new TextDecoder().decode(expected))), expected)
  assert.deepEqual(decodeWailsBytes(Array.from(expected)), expected)
  assert.throws(() => decodeWailsBytes({ data: 'not-bytes' }), /Unexpected Wails byte payload/u)
})

await test('CLI dock renders bounded structured output without hiding diagnostics', () => {
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.output', payload: { state: 'missing' } }), '{"state":"missing"}')
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'diagnostic', message: 'safe failure' }), 'safe failure')
  assert.equal(summarizeCLIEvent({ schemaVersion: 'cli-events/v1', type: 'run.output', payload: 'x'.repeat(700) }).length, 601)
})

await test('Core-backed plugin status distinguishes ready, not-ready and unavailable payloads', () => {
  assert.equal(parsePluginReadiness('{"readiness":{"ready":true,"generation":"3"}}'), 'ready')
  assert.equal(parsePluginReadiness('{"identity":{"ready":false}}'), 'not-ready')
  assert.equal(parsePluginReadiness('{"instanceId":"echo"}'), 'unknown')
  assert.equal(parsePluginReadiness('not-json'), 'unknown')
})
