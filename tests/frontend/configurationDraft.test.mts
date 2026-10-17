import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cloneConfigurationObject, configurationDraftKey, configurationJSONDocumentPatch, configurationPathEditable, configurationSchemaContainsProtectedField, isConfigurationPatchEmpty, isProtectedConfigurationArrayFieldPath, isProtectedConfigurationArrayPath, mergeConfiguration, parseConfigurationJSONDocument, parseConfigurationNumber, updateConfigurationMapOperationPatch, updateConfigurationPatch, updateProtectedConfigurationArrayFieldPatch, updateProtectedConfigurationArrayOperationPatch } from '../../frontend/src/models/configurationDraft.ts'
import { configurationArrayOperationRequest } from '../../frontend/src/models/configurationArray.ts'
import { configurationMapOperationRequest } from '../../frontend/src/models/configurationMap.ts'
import { useStudioStore } from '../../frontend/src/stores/studio.ts'

await test('JSON document editor accepts only bounded safe JSON objects', () => {
  assert.deepEqual(parseConfigurationJSONDocument('{"type":"object","properties":{"enabled":{"type":"boolean"}}}'), {
    valid: true, value: { type: 'object', properties: { enabled: { type: 'boolean' } } },
  })
  assert.deepEqual(parseConfigurationJSONDocument('"text example"', true), { valid: true, value: 'text example' })
  assert.deepEqual(parseConfigurationJSONDocument('null', true), { valid: true, value: null })
  assert.equal(parseConfigurationJSONDocument('"text example"').valid, false)
  assert.equal(parseConfigurationJSONDocument('[').valid, false)
  assert.equal(parseConfigurationJSONDocument('[]').valid, false)
  assert.equal(parseConfigurationJSONDocument('{"__proto__":{"polluted":true}}').valid, false)
  assert.equal(parseConfigurationJSONDocument(JSON.stringify({ schema: 'x'.repeat(1_048_576) }), true).valid, false)
})

await test('configuration draft updates nested paths and removes reverted changes', () => {
  const base = { listener: { port: 8080, tls: true }, labels: ['api', 'public'] }
  let patch = updateConfigurationPatch(base, {}, ['listener', 'port'], 8443)
  assert.deepEqual(patch, { listener: { port: 8443 } })
  assert.deepEqual(mergeConfiguration(base, patch), { listener: { port: 8443, tls: true }, labels: ['api', 'public'] })

  patch = updateConfigurationPatch(base, patch, ['listener', 'tls'], false)
  assert.deepEqual(patch, { listener: { port: 8443, tls: false } })
  patch = updateConfigurationPatch(base, patch, ['listener', 'port'], 8080)
  assert.deepEqual(patch, { listener: { tls: false } })
  patch = updateConfigurationPatch(base, patch, ['listener', 'tls'], true)
  assert.deepEqual(patch, {})
  assert.equal(isConfigurationPatchEmpty(patch), true)
})

await test('arrays are replaced atomically unless they contain protected fields', () => {
  const base = { routes: [{ path: '/health' }] }
  const patch = updateConfigurationPatch(base, {}, ['routes'], [{ path: '/ready' }, { path: '/metrics' }])
  assert.deepEqual(mergeConfiguration(base, patch), { routes: [{ path: '/ready' }, { path: '/metrics' }] })
  assert.notEqual(configurationDraftKey('/projects/a', 'b'), configurationDraftKey('/projects', 'a/b'))
})

await test('typed configuration maps support safe add, update, remove, composition, and bounded undo state', () => {
  const base = { labels: { east: 1, west: 2 } }
  const schema = { type: 'object', properties: { labels: { type: 'object', minProperties: 1, maxProperties: 4, additionalProperties: { type: 'integer', minimum: 0 } } } }
  let patch = updateConfigurationMapOperationPatch(base, {}, schema, ['labels'], { op: 'remove', key: 'east' })
  patch = updateConfigurationPatch(base, patch, ['labels', 'north'], 3)
  assert.deepEqual(mergeConfiguration(base, patch), { labels: { west: 2, north: 3 } })
  assert.equal(JSON.stringify(patch).includes('east'), true)

  const addThenRemove = updateConfigurationMapOperationPatch(base, updateConfigurationPatch(base, {}, ['labels', 'north'], 3), schema, ['labels'], { op: 'remove', key: 'north' })
  assert.deepEqual(addThenRemove, {})
  assert.deepEqual(mergeConfiguration(base, addThenRemove), base)
  const editThenRemove = updateConfigurationMapOperationPatch(base, updateConfigurationPatch(base, {}, ['labels', 'east'], 9), schema, ['labels'], { op: 'remove', key: 'east' })
  assert.deepEqual(mergeConfiguration(base, editThenRemove), { labels: { west: 2 } })
  assert.throws(() => updateConfigurationMapOperationPatch({ labels: { east: 1 } }, {}, schema, ['labels'], { op: 'remove', key: 'east' }), /minimum property count/u)
  assert.throws(() => updateConfigurationMapOperationPatch(base, {}, schema, ['labels'], { op: 'remove', key: 'missing' }), /unavailable/u)
  assert.throws(() => updateConfigurationMapOperationPatch(base, {}, schema, ['labels'], { op: 'remove', key: 'apiToken' }), /not editable/u)
  assert.throws(() => updateConfigurationMapOperationPatch(base, {}, { type: 'object', properties: { labels: { type: 'object', additionalProperties: true } } }, ['labels'], { op: 'remove', key: 'east' }), /safe typed contract/u)
})

await test('Zustand routes typed map remove requests through the shared draft and history', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project-map', serviceId: 'server', settingsPath: 'services/server/settings.json', schemaPath: 'schemas/server.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  const schema = { type: 'object', properties: { labels: { type: 'object', minProperties: 1, additionalProperties: { type: 'string' } } } }
  useStudioStore.getState().hydrateServiceSettingsDraft(key, schema, { labels: { east: '1', west: '2' } }, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['labels'], configurationMapOperationRequest({ op: 'remove', key: 'east' }))
  let draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { labels: { west: '2' } })
  useStudioStore.getState().undoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { labels: { east: '1', west: '2' } })
  useStudioStore.getState().redoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { labels: { west: '2' } })
  assert.throws(() => { useStudioStore.getState().updateServiceSettingsDraft(key, ['labels'], { '$studioMapOps/v1': [] }) }, /operation request is invalid/u)
})

await test('protected array items use sparse leaf patches and preserve the redacted base shape', () => {
  const base = { routes: [{ path: '/health', token: null, generated: 'managed' }] }
  const patch = updateConfigurationPatch(base, {}, ['routes', '0', 'path'], '/ready')
  assert.deepEqual(patch, { routes: { '0': { path: '/ready' } } })
  assert.deepEqual(mergeConfiguration(base, patch), { routes: [{ path: '/ready', token: null, generated: 'managed' }] })

  const schema = { type: 'object', properties: { routes: { type: 'array', items: { type: 'object', properties: {
    path: { type: 'string' }, token: { type: 'string', 'x-sensitive': true }, generated: { type: 'string', readOnly: true },
  } } } } }
  assert.equal(configurationPathEditable(schema, ['routes']), false)
  assert.equal(configurationPathEditable(schema, ['routes', '0', 'path']), true)
  assert.equal(configurationPathEditable(schema, ['routes', '0', 'token']), false)
  assert.equal(configurationPathEditable(schema, ['routes', '0', 'generated']), false)
  assert.equal(configurationPathEditable(schema, ['routes', '00', 'path']), false)
})

await test('protected array add then remove compacts to a clean patch without dropping sibling edits', () => {
  const base = {
    enabled: false,
    routes: [{ path: '/echo', credentialRef: null, generatedId: 'managed-echo' }],
  }
  const schema = { type: 'object', properties: {
    enabled: { type: 'boolean' },
    routes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string' },
      credentialRef: { type: 'string', 'x-sensitive': true },
      generatedId: { type: 'string', readOnly: true },
    } } },
  } }

  let patch = updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['routes'], {
    op: 'insert', index: 1, value: { path: '/temporary', credentialRef: null },
  })
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['routes'], { op: 'remove', index: 1 })
  assert.deepEqual(patch, {})
  assert.deepEqual(mergeConfiguration(base, patch), base)

  patch = updateConfigurationPatch(base, {}, ['enabled'], true)
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['routes'], {
    op: 'insert', index: 1, value: { path: '/temporary', credentialRef: null },
  })
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['routes'], { op: 'remove', index: 1 })
  assert.deepEqual(patch, { enabled: true })
  assert.deepEqual(mergeConfiguration(base, patch), { ...base, enabled: true })

  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/protected-array-revert', serviceId: 'server', settingsPath: 'services/server/settings.json', schemaPath: 'schemas/server.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  useStudioStore.getState().hydrateServiceSettingsDraft(key, schema, base, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['routes'], configurationArrayOperationRequest({
    op: 'insert', index: 1, value: { path: '/temporary', credentialRef: null },
  }))
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'dirty')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['routes'], configurationArrayOperationRequest({ op: 'remove', index: 1 }))
  const restored = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(restored)
  assert.equal(restored.status, 'clean')
  assert.deepEqual(restored.patch, {})
})

await test('protected array operations interleave structural edits and safe field patches without exposing hidden data', () => {
  const base = { listeners: [
    { id: 'plain', address: ':8080', credentialRef: null, managedId: 'core-a' },
    { id: 'tls', address: ':8443', credentialRef: null, managedId: 'core-b' },
  ] }
  const schema = { type: 'object', properties: { listeners: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
    id: { type: 'string' }, address: { type: 'string' }, credentialRef: { type: 'string', 'x-sensitive': true }, managedId: { type: 'string', readOnly: true },
  } } } } }
  assert.equal(isProtectedConfigurationArrayPath(base, {}, schema, ['listeners']), true)
  assert.equal(isProtectedConfigurationArrayFieldPath(base, {}, schema, ['listeners', '0', 'address']), true)

  let patch = updateConfigurationPatch(base, {}, ['listeners', '0', 'address'], ':8081')
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['listeners'], { op: 'move', from: 0, to: 1 })
  patch = updateProtectedConfigurationArrayFieldPatch(base, patch, schema, ['listeners', '0', 'address'], ':9443')
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['listeners'], { op: 'duplicate', index: 0, to: 1 })
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['listeners'], { op: 'remove', index: 2 })
  const serializedPatch = JSON.stringify(patch)
  assert.equal(serializedPatch.includes('core-a'), false)
  assert.equal(serializedPatch.includes('core-b'), false)
  assert.equal(serializedPatch.includes('credentialRef'), false)
  assert.deepEqual(mergeConfiguration(base, patch), { listeners: [
    { id: 'tls', address: ':9443', credentialRef: null, managedId: 'core-b' },
    { id: 'tls', address: ':9443', credentialRef: null, managedId: 'core-b' },
  ] })
})

await test('protected array structural operation requests are bounded by current length and schema limits', () => {
  const base = { routes: [{ path: '/a', token: null }, { path: '/b', token: null }] }
  const schema = { type: 'object', properties: { routes: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', properties: {
    path: { type: 'string' }, token: { type: 'string', writeOnly: true },
  } } } } }
  assert.throws(() => updateProtectedConfigurationArrayOperationPatch({ routes: [{ path: '/only', token: null }] }, {}, schema, ['routes'], { op: 'remove', index: 0 }), /minimum item count/u)
  assert.throws(() => updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['routes'], { op: 'duplicate', index: 0, to: 1 }), /maximum item count/u)
  assert.throws(() => updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['routes'], { op: 'set', index: 0, patch: { token: 'secret' } }), /Field edits must use/u)
  assert.throws(() => updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['routes'], { op: 'move', from: 0, to: 2 }), /out of range/u)
})

await test('protected array insert keeps incomplete items editable in the shared draft and swap remains safe', () => {
  const base = { routes: [{ path: '/health', credentialRef: null }, { path: '/metrics', credentialRef: null }] }
  const schema = { type: 'object', properties: { routes: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['path'], properties: {
    path: { type: 'string', minLength: 1 }, credentialRef: { type: 'string', 'x-sensitive': true },
  } } } } }
  let patch = updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['routes'], { op: 'insert', index: 1, value: { path: '' } })
  assert.deepEqual(mergeConfiguration(base, patch), { routes: [
    { path: '/health', credentialRef: null },
    { path: '' },
    { path: '/metrics', credentialRef: null },
  ] })
  patch = updateProtectedConfigurationArrayFieldPatch(base, patch, schema, ['routes', '1', 'path'], '/echo')
  patch = updateProtectedConfigurationArrayOperationPatch(base, patch, schema, ['routes'], { op: 'swap', left: 0, right: 2 })
  assert.deepEqual(mergeConfiguration(base, patch), { routes: [
    { path: '/metrics', credentialRef: null },
    { path: '/echo' },
    { path: '/health', credentialRef: null },
  ] })
  assert.equal(JSON.stringify(patch).includes('credentialRef'), false)
})

await test('protected array insertion envelopes nested JSON documents for the host and projects plain values', () => {
  const base = { routes: [{ id: 'health', credentialRef: null, api: { responses: [] } }] }
  const schema = { type: 'object', properties: { routes: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, credentialRef: { type: 'string', 'x-sensitive': true },
    api: { type: 'object', properties: { responses: { type: 'array', items: { type: 'object', properties: {
      contentType: { type: 'string' }, schema: { type: 'object', additionalProperties: true, 'x-studio-json-document': true },
    } } } } },
  } } } } }
  const route = { id: 'echo', api: { responses: [{ contentType: 'application/json', schema: { type: 'object', properties: { message: { type: 'string' } } } }] } }
  const patch = updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['routes'], { op: 'insert', index: 1, value: route })
  assert.deepEqual(mergeConfiguration(base, patch), { routes: [base.routes[0], route] })
  assert.deepEqual((patch.routes as { '$studioArrayOps/v1': Array<{ value: typeof route }> })['$studioArrayOps/v1'][0]?.value.api.responses[0]?.schema, {
    '$studioJSONDocument/v1': route.api.responses[0]?.schema,
  })
})

await test('protected array detection resolves project-local item references', () => {
  const base = { listeners: [{ address: ':8080', credentialRef: null }] }
  const schema = { type: 'object', $defs: { listener: { type: 'object', properties: {
    address: { type: 'string' }, credentialRef: { type: 'string', 'x-sensitive': true },
  } } }, properties: { listeners: { type: 'array', items: { $ref: '#/$defs/listener' } } } }
  assert.equal(isProtectedConfigurationArrayPath(base, {}, schema, ['listeners']), true)
  assert.equal(isProtectedConfigurationArrayFieldPath(base, {}, schema, ['listeners', '0', 'address']), true)
  const patch = updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['listeners'], { op: 'move', from: 0, to: 0 })
  assert.deepEqual(mergeConfiguration(base, patch), base)
})

await test('nested protected array operations remain scoped inside the enclosing protected item', () => {
  const base = { groups: [{ id: 'group-a', keyRef: null, routes: [
    { path: '/a', credentialRef: null },
    { path: '/b', credentialRef: null },
  ] }] }
  const schema = { type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, keyRef: { type: 'string', 'x-sensitive': true },
    routes: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, credentialRef: { type: 'string', writeOnly: true },
    } } },
  } } } } }
  let patch = updateProtectedConfigurationArrayOperationPatch(base, {}, schema, ['groups', '0', 'routes'], { op: 'move', from: 0, to: 1 })
  patch = updateProtectedConfigurationArrayFieldPatch(base, patch, schema, ['groups', '0', 'routes', '0', 'path'], '/ready')
  const serialized = JSON.stringify(patch)
  assert.equal(serialized.includes('keyRef'), false)
  assert.equal(serialized.includes('credentialRef'), false)
  assert.deepEqual(mergeConfiguration(base, patch), { groups: [{ id: 'group-a', keyRef: null, routes: [
    { path: '/ready', credentialRef: null },
    { path: '/a', credentialRef: null },
  ] }] })
})

await test('draft path updates reject prototype keys and non-JSON values', () => {
  assert.throws(() => updateConfigurationPatch({}, {}, ['__proto__', 'polluted'], true), /Invalid configuration field path/u)
  assert.throws(() => updateConfigurationPatch({}, {}, ['value'], Number.POSITIVE_INFINITY), /finite JSON numbers/u)
  assert.throws(() => cloneConfigurationObject({ value: undefined }), /non-JSON value/u)
})

await test('numeric configuration input rejects incomplete and out-of-schema values', () => {
  const integer = { type: 'integer', minimum: 1, maximum: 10, multipleOf: 2 }
  assert.deepEqual(parseConfigurationNumber('', integer), { valid: false, reason: 'empty' })
  assert.deepEqual(parseConfigurationNumber('nope', integer), { valid: false, reason: 'number' })
  assert.deepEqual(parseConfigurationNumber('2.5', integer), { valid: false, reason: 'integer' })
  assert.deepEqual(parseConfigurationNumber('0', integer), { valid: false, reason: 'minimum' })
  assert.deepEqual(parseConfigurationNumber('11', integer), { valid: false, reason: 'maximum' })
  assert.deepEqual(parseConfigurationNumber('3', integer), { valid: false, reason: 'multipleOf' })
  assert.deepEqual(parseConfigurationNumber('8', integer), { valid: true, value: 8 })
  assert.deepEqual(parseConfigurationNumber('1', { type: 'number', exclusiveMinimum: 1 }), { valid: false, reason: 'exclusiveMinimum' })
  assert.deepEqual(parseConfigurationNumber('5', { type: 'number', exclusiveMaximum: 5 }), { valid: false, reason: 'exclusiveMaximum' })
  assert.deepEqual(parseConfigurationNumber('1.25', { type: 'number', multipleOf: 0.05 }), { valid: true, value: 1.25 })
  assert.deepEqual(parseConfigurationNumber('-0.3', { type: 'number', multipleOf: 0.1 }), { valid: true, value: -0.3 })
  assert.deepEqual(parseConfigurationNumber('9007199254740992', { type: 'integer' }), { valid: false, reason: 'integer' })
})

await test('schema-bound draft edits deny unknown, sensitive, read-only and array-item paths', () => {
  const schema = { type: 'object', properties: {
    listener: { type: 'object', properties: { port: { type: 'integer' }, token: { type: 'string', writeOnly: true } } },
    routes: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' } } } },
    generated: { type: 'string', readOnly: true },
  } }
  assert.equal(configurationPathEditable(schema, ['listener', 'port']), true)
  assert.equal(configurationPathEditable(schema, ['listener', 'token']), false)
  assert.equal(configurationPathEditable(schema, ['generated']), false)
  assert.equal(configurationPathEditable(schema, ['unknown']), false)
  assert.equal(configurationPathEditable(schema, ['routes']), true)
  assert.equal(configurationPathEditable(schema, ['routes', '0', 'path']), true)
  assert.equal(configurationPathEditable({ type: 'object', properties: { privateKeyRef: { type: 'string' } } }, ['privateKeyRef']), false)
  assert.equal(configurationPathEditable({ type: 'object', properties: { credentialMaterial: { type: 'string', 'x-sensitive': true } } }, ['credentialMaterial']), false)
})

await test('schema-bound edits resolve local refs through nested protected collections without allowing protected leaves', () => {
  const schema = {
    type: 'object',
    properties: { config: { $ref: '#/$defs/config' } },
    $defs: {
      config: { type: 'object', properties: { routes: { type: 'array', items: { $ref: '#/$defs/route' } } } },
      route: { type: 'object', properties: { api: { $ref: '#/$defs/api' } } },
      api: { type: 'object', properties: { responses: { type: 'array', items: { $ref: '#/$defs/response' } } } },
      response: { type: 'object', additionalProperties: false, properties: {
        contentType: { type: 'string' },
        schema: { type: 'object', properties: { type: { type: 'string' } } },
        credentialMaterial: { type: 'string', writeOnly: true },
      } },
    },
  }

  assert.equal(configurationPathEditable(schema, ['config', 'routes', '0', 'api', 'responses', '0', 'contentType']), true)
  assert.equal(configurationPathEditable(schema, ['config', 'routes', '0', 'api', 'responses', '0', 'credentialMaterial']), false)
  assert.equal(configurationPathEditable(schema, ['config', 'routes']), false)
  assert.equal(configurationPathEditable({ type: 'object', properties: { config: { $ref: 'https://example.invalid/schema' } } }, ['config', 'value']), false)
})

await test('array schemas fail closed when any composition branch contains protected fields', () => {
  const union = { oneOf: [
    { type: 'object', properties: { address: { type: 'string' } } },
    { type: 'object', properties: { credentialMaterial: { type: 'string', 'x-sensitive': true } } },
  ] }
  assert.equal(configurationSchemaContainsProtectedField(union), true)
  assert.equal(configurationSchemaContainsProtectedField({ type: 'object', properties: { port: { type: 'integer' } } }), false)
})

await test('variant writes permit only complete safe branches of a secret-bearing oneOf', () => {
  const schema = { type: 'object', properties: { config: { type: 'object', properties: { tls: { anyOf: [
    { $ref: '#/$defs/tls' },
    { type: 'object', required: ['mode'], properties: { mode: { const: 'disabled' } } },
  ] } } } }, $defs: { tls: { oneOf: [
    { type: 'object', required: ['mode'], properties: { mode: { const: 'automatic' } } },
    { type: 'object', required: ['mode', 'privateKeyRef'], properties: { mode: { const: 'custom' }, privateKeyRef: { type: 'string' } } },
    { type: 'object', required: ['mode'], properties: { mode: { const: 'disabled' } } },
  ] } } }
  assert.equal(configurationPathEditable(schema, ['config', 'tls'], { mode: 'automatic' }), true)
  assert.equal(configurationPathEditable(schema, ['config', 'tls'], { mode: 'disabled' }), true)
  assert.equal(configurationPathEditable(schema, ['config', 'tls'], { mode: 'custom', privateKeyRef: 'secret' }), false)
  assert.equal(configurationPathEditable(schema, ['config', 'tls']), false)
})

await test('only explicitly annotated JSON documents can replace an otherwise open object', () => {
  const schema = { type: 'object', properties: {
    responseSchema: { type: 'object', additionalProperties: true, 'x-studio-json-document': true },
    responseExample: { 'x-studio-json-value': true },
    arbitrary: { type: 'object', additionalProperties: true },
  } }

  assert.equal(configurationPathEditable(schema, ['responseSchema']), true)
  assert.equal(configurationPathEditable(schema, ['responseSchema', 'properties']), false)
  assert.equal(configurationPathEditable(schema, ['responseExample']), true)
  assert.equal(configurationPathEditable(schema, ['arbitrary']), false)

  const base = { responseSchema: { type: 'object', additionalProperties: true }, responseExample: {} }
  const patch = updateConfigurationPatch(base, {}, ['responseSchema'], configurationJSONDocumentPatch({ type: 'string' }))
  const valuePatch = updateConfigurationPatch(base, patch, ['responseExample'], configurationJSONDocumentPatch('plain text example'))
  assert.deepEqual(mergeConfiguration(base, valuePatch), { responseSchema: { type: 'string' }, responseExample: 'plain text example' })
  assert.deepEqual(configurationJSONDocumentPatch('plain text example'), { '$studioJSONDocument/v1': 'plain text example' })
})

await test('Zustand wraps arbitrary JSON value edits and restores canonical values in the shared draft', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project-json-value', serviceId: 'server', settingsPath: 'services/server/settings.json', schemaPath: 'schemas/server.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  const schema = { type: 'object', properties: { example: { 'x-studio-json-value': true } } }
  useStudioStore.getState().hydrateServiceSettingsDraft(key, schema, { example: {} }, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['example'], 'text example')
  const draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.deepEqual(draft.patch, { example: { '$studioJSONDocument/v1': 'text example' } })
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { example: 'text example' })
})

await test('whole-object replacement is denied when any composition branch has protected values', () => {
  const schema = { type: 'object', properties: { handler: { oneOf: [
    { type: 'object', properties: { kind: { const: 'safe' }, address: { type: 'string' } } },
    { type: 'object', properties: { kind: { const: 'credential' }, privateKeyRef: { type: 'string' } } },
  ] } } }
  assert.equal(configurationPathEditable(schema, ['handler']), false)
  assert.equal(configurationPathEditable(schema, ['handler', 'kind']), true)
  assert.equal(configurationPathEditable(schema, ['handler', 'address']), true)
  assert.equal(configurationPathEditable(schema, ['handler', 'privateKeyRef']), false)
})

await test('Zustand keeps one project-scoped settings draft across inspector consumers', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project-a', projectRoot: '/tmp/project-a', serviceId: 'server', settingsPath: 'services/server/settings.json', schemaPath: 'schemas/server.json' }
  const first = useStudioStore.getState().beginServiceSettingsDraft(identity)
  assert.equal(first.shouldLoad, true)
  useStudioStore.getState().hydrateServiceSettingsDraft(first.key, { type: 'object', properties: { listener: { type: 'object', properties: { port: { type: 'integer' } } } } }, { listener: { port: 8080 } }, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(first.key, ['listener', 'port'], 8443)

  const reopened = useStudioStore.getState().beginServiceSettingsDraft(identity)
  assert.equal(reopened.key, first.key)
  assert.equal(reopened.shouldLoad, false)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[first.key]?.status, 'dirty')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[first.key]?.patch, { listener: { port: 8443 } })

  const secondProject = useStudioStore.getState().beginServiceSettingsDraft({ ...identity, projectRoot: '/tmp/project-b' })
  assert.notEqual(secondProject.key, first.key)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[secondProject.key]?.status, 'loading')
})

await test('Zustand routes protected array fields and structural actions through safe operations', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project', serviceId: 'server', settingsPath: 'services/server/settings.json', schemaPath: 'schemas/server.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  const schema = { type: 'object', properties: { routes: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'object', properties: {
    path: { type: 'string' }, token: { type: 'string', 'x-sensitive': true }, generatedId: { type: 'string', readOnly: true },
  } } } } }
  useStudioStore.getState().hydrateServiceSettingsDraft(key, schema, { routes: [
    { path: '/a', token: null, generatedId: 'managed-a' },
    { path: '/b', token: null, generatedId: 'managed-b' },
  ] }, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['routes', '0', 'path'], '/health')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['routes'], configurationArrayOperationRequest({ op: 'move', from: 0, to: 1 }))
  const draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(JSON.stringify(draft.patch).includes('managed-a'), false)
  assert.equal(JSON.stringify(draft.patch).includes('token'), false)
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { routes: [
    { path: '/b', token: null, generatedId: 'managed-b' },
    { path: '/health', token: null, generatedId: 'managed-a' },
  ] })
  assert.throws(() => { useStudioStore.getState().updateServiceSettingsDraft(key, ['routes', '0', 'token'], 'injected') }, /unknown, read-only, or sensitive/u)
  assert.throws(() => { useStudioStore.getState().updateServiceSettingsDraft(key, ['routes'], configurationArrayOperationRequest({ op: 'remove', index: 1 })) }, /minimum item count/u)
})

await test('Zustand provides bounded logical undo/redo for configuration edits', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project', serviceId: 'echo', settingsPath: 'services/echo/settings.json', schemaPath: 'schemas/echo.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  useStudioStore.getState().hydrateServiceSettingsDraft(key, { type: 'object', properties: {
    listener: { type: 'object', properties: { port: { type: 'integer' }, host: { type: 'string' } } },
  } }, { listener: { port: 8080, host: '127.0.0.1' } }, 'sha256:base')

  useStudioStore.getState().updateServiceSettingsDraft(key, ['listener', 'port'], 8081)
  useStudioStore.getState().updateServiceSettingsDraft(key, ['listener', 'port'], 8082)
  let draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.history.undo.length, 1, 'rapid edits to one field coalesce into a single logical action')
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { listener: { port: 8082, host: '127.0.0.1' } })

  useStudioStore.getState().undoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.status, 'clean')
  assert.deepEqual(draft.patch, {})
  assert.equal(draft.history.redo.length, 1)

  useStudioStore.getState().redoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.status, 'dirty')
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { listener: { port: 8082, host: '127.0.0.1' } })

  useStudioStore.getState().updateServiceSettingsDraft(key, ['listener', 'host'], 'localhost')
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.history.redo.length, 0, 'a new edit invalidates the redo branch')
  useStudioStore.getState().undoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { listener: { port: 8082, host: '127.0.0.1' } })
})

await test('protected-array undo history stores only safe patches and treats structural edits separately', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project', serviceId: 'server', settingsPath: 'services/server/settings.json', schemaPath: 'schemas/server.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  const schema = { type: 'object', properties: { listeners: { type: 'array', items: { type: 'object', properties: {
    address: { type: 'string' }, credentialRef: { type: 'string', 'x-sensitive': true },
  } } } } }
  useStudioStore.getState().hydrateServiceSettingsDraft(key, schema, { listeners: [
    { address: ':8080', credentialRef: 'private-a' }, { address: ':8443', credentialRef: 'private-b' },
  ] }, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['listeners'], configurationArrayOperationRequest({ op: 'move', from: 0, to: 1 }))
  useStudioStore.getState().updateServiceSettingsDraft(key, ['listeners'], configurationArrayOperationRequest({ op: 'move', from: 1, to: 0 }))

  let draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.history.undo.length, 2)
  const historyJSON = JSON.stringify(draft.history)
  assert.equal(historyJSON.includes('private-a'), false)
  assert.equal(historyJSON.includes('private-b'), false)
  assert.equal(historyJSON.includes('credentialRef'), false)

  useStudioStore.getState().undoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.deepEqual(mergeConfiguration(draft.base, draft.patch), { listeners: [
    { address: ':8443', credentialRef: 'private-b' }, { address: ':8080', credentialRef: 'private-a' },
  ] })
  useStudioStore.getState().undoServiceSettingsDraft(key)
  draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.status, 'clean')
  assert.deepEqual(draft.patch, {})
})

await test('configuration undo history retains only the newest bounded set of actions', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project', serviceId: 'echo', settingsPath: 'services/echo/settings.json', schemaPath: 'schemas/echo.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  const properties = Object.fromEntries(Array.from({ length: 55 }, (_, index) => [`field${String(index)}`, { type: 'integer' }]))
  const base = Object.fromEntries(Array.from({ length: 55 }, (_, index) => [`field${String(index)}`, 0]))
  useStudioStore.getState().hydrateServiceSettingsDraft(key, { type: 'object', properties }, base, 'sha256:base')
  for (let index = 0; index < 55; index += 1) {
    useStudioStore.getState().updateServiceSettingsDraft(key, [`field${String(index)}`], index + 1)
  }
  const draft = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(draft)
  assert.equal(draft.history.undo.length, 50)
  for (let index = 0; index < 50; index += 1) useStudioStore.getState().undoServiceSettingsDraft(key)
  const afterUndo = useStudioStore.getState().serviceSettingsDrafts[key]
  assert.ok(afterUndo)
  assert.deepEqual(mergeConfiguration(afterUndo.base, afterUndo.patch), {
    ...base,
    field0: 1, field1: 2, field2: 3, field3: 4, field4: 5,
  })
})

await test('saving freezes the draft and only clears the matching revision', () => {
  useStudioStore.setState({ serviceSettingsDrafts: {} })
  const identity = { projectId: 'project', projectRoot: '/tmp/project', serviceId: 'echo', settingsPath: 'services/echo/settings.json', schemaPath: 'schemas/echo.json' }
  const { key } = useStudioStore.getState().beginServiceSettingsDraft(identity)
  useStudioStore.getState().hydrateServiceSettingsDraft(key, { type: 'object', properties: { prefix: { type: 'string' } } }, { prefix: '' }, 'sha256:base')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['prefix'], 'seen:')
  const revision = useStudioStore.getState().beginServiceSettingsDraftSave(key)
  assert.notEqual(revision, null)
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'saving')
  useStudioStore.getState().updateServiceSettingsDraft(key, ['prefix'], 'ignored-during-save')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, { prefix: 'seen:' })
  useStudioStore.getState().completeServiceSettingsDraftSave(key, revision ?? -1, { prefix: 'seen:' }, 'sha256:updated')
  assert.equal(useStudioStore.getState().serviceSettingsDrafts[key]?.status, 'clean')
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.patch, {})
  assert.deepEqual(useStudioStore.getState().serviceSettingsDrafts[key]?.history, { undo: [], redo: [], coalesceKey: '', coalesceAt: 0 })
})
