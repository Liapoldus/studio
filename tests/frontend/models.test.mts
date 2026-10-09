import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductInfo, models } from '../../frontend/src/api/info.ts'

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
