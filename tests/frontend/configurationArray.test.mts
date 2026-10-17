import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyConfigurationArrayOperations, configurationArrayOperationRequest, configurationArrayOperations, createConfigurationArrayItem, duplicateConfigurationArrayItem, moveConfigurationArrayItem, removeConfigurationArrayItem, reorderConfigurationArrayItem } from '../../frontend/src/models/configurationArray.ts'

await test('array item template honours object defaults and required primitive types', () => {
  const value = createConfigurationArrayItem({
    type: 'object',
    required: ['name', 'enabled', 'port'],
    properties: {
      name: { type: 'string' },
      enabled: { type: 'boolean' },
      port: { type: 'integer', minimum: 8080 },
      note: { type: 'string', default: 'optional' },
      omitted: { type: 'string' },
    },
  })
  assert.deepEqual(value, { name: '', enabled: false, port: 8080, note: 'optional' })
})

await test('array duplicate, removal and reorder preserve exact item order', () => {
  const values = ['a', 'b', 'c', 'd']
  assert.deepEqual(duplicateConfigurationArrayItem(values, 1), ['a', 'b', 'b', 'c', 'd'])
  assert.deepEqual(removeConfigurationArrayItem(values, 1), ['a', 'c', 'd'])
  assert.deepEqual(moveConfigurationArrayItem(values, 2, -1), ['a', 'c', 'b', 'd'])
  assert.deepEqual(reorderConfigurationArrayItem(values, 0, 3), ['b', 'c', 'd', 'a'])
  assert.deepEqual(reorderConfigurationArrayItem(values, 3, 0), ['d', 'a', 'b', 'c'])
  assert.throws(() => duplicateConfigurationArrayItem(values, 4), RangeError)
  assert.throws(() => removeConfigurationArrayItem(values, 0, 4), /minimum item count/u)
})

await test('array duplication makes an independent JSON value', () => {
  const result = duplicateConfigurationArrayItem([{ route: { path: '/health' } }], 0) as Array<{ route: { path: string } }>
  const original = result[0]
  const copy = result[1]
  assert.ok(original)
  assert.ok(copy)
  copy.route.path = '/echo'
  assert.equal(original.route.path, '/health')
})

await test('protected array operations preserve redacted and read-only item fields', () => {
  const canonicalProjection = [
    { id: 'plain', address: ':8080', credentialRef: null, managedId: 'core-a' },
    { id: 'tls', address: ':8443', credentialRef: null, managedId: 'core-b' },
  ]
  const envelope = configurationArrayOperationRequest({ op: 'move', from: 0, to: 1 })
  const operations = configurationArrayOperations(envelope)
  assert.ok(operations)
  const result = applyConfigurationArrayOperations(canonicalProjection, [
    ...operations,
    { op: 'set', index: 0, patch: { address: ':9443' } },
    { op: 'duplicate', index: 0, to: 1 },
    { op: 'remove', index: 2 },
  ]) as typeof canonicalProjection
  assert.deepEqual(result, [
    { id: 'tls', address: ':9443', credentialRef: null, managedId: 'core-b' },
    { id: 'tls', address: ':9443', credentialRef: null, managedId: 'core-b' },
  ])
})

await test('protected array insert and swap preserve array semantics and validate the operation envelope', () => {
  const values = [{ id: 'health' }, { id: 'metrics' }]
  const insert = configurationArrayOperations(configurationArrayOperationRequest({ op: 'insert', index: 1, value: { id: 'echo' } }))
  const swap = configurationArrayOperations(configurationArrayOperationRequest({ op: 'swap', left: 0, right: 2 }))
  assert.ok(insert)
  assert.ok(swap)
  const inserted = applyConfigurationArrayOperations(values, insert)
  assert.deepEqual(inserted, [{ id: 'health' }, { id: 'echo' }, { id: 'metrics' }])
  assert.deepEqual(applyConfigurationArrayOperations(inserted, swap), [{ id: 'metrics' }, { id: 'echo' }, { id: 'health' }])
  assert.equal(configurationArrayOperations({ '$studioArrayOps/v1': [{ op: 'insert', index: 0, value: { constructor: true } }] }), null)
  assert.throws(() => applyConfigurationArrayOperations(values, [{ op: 'insert', index: 3, value: {} }]), /insertion index/u)
})

await test('protected array operation envelopes reject malformed and unbounded operations', () => {
  assert.equal(configurationArrayOperations({ $studioArrayOps: [] }), null)
  assert.equal(configurationArrayOperations({ '$studioArrayOps/v1': [] }), null)
  assert.equal(configurationArrayOperations({ '$studioArrayOps/v1': [{ op: 'add', index: 0 }] }), null)
  assert.equal(configurationArrayOperations({ '$studioArrayOps/v1': [{ op: 'remove', index: -1 }] }), null)
  assert.equal(configurationArrayOperations({ '$studioArrayOps/v1': [{ op: 'move', from: 1.5, to: 0 }] }), null)
  assert.throws(() => applyConfigurationArrayOperations(['a'], [{ op: 'duplicate', index: 0, to: 3 }]), RangeError)
})
