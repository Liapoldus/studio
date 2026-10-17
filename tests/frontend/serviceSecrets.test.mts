import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDeclaredSecretPurposes, parseServiceSecretCatalog, parseServiceSecretCatalogDetails, parseServiceSecretRotationResult, serviceSecretJSONPointer, serviceSecretReferencePaths } from '../../frontend/src/models/serviceSecrets.ts'

await test('secret manager purposes are deduplicated and validated as public manifest metadata', () => {
  assert.deepEqual(parseDeclaredSecretPurposes('{"id":"server","secretPurposes":["http.auth.bearer","http.auth.bearer","server.tls.key"]}', 'server'), ['http.auth.bearer', 'server.tls.key'])
  for (const raw of [
    '{"id":"other","secretPurposes":["http.auth.bearer"]}',
    '{"id":"server","secretPurposes":"http.auth.bearer"}',
    '{"id":"server","secretPurposes":["invalid purpose"]}',
  ]) assert.throws(() => parseDeclaredSecretPurposes(raw, 'server'))
})

await test('secret catalog contains only local service-bound opaque references and safe metadata', () => {
  const reference = 'ssr:v1:00112233445566778899aabbccddeeff'
  const item = { reference, serviceId: 'server', purpose: 'http.auth.bearer', label: 'Gateway', state: 'active', createdAt: '2026-10-17T00:00:00Z' }
  const catalog = { schemaVersion: 'service-secret-references/v1', target: 'local', serviceId: 'server', items: [item], pendingRotations: [], pendingRegistrations: [] }
  assert.deepEqual(parseServiceSecretCatalog(JSON.stringify(catalog), 'server'), [item])
  assert.deepEqual(parseServiceSecretCatalogDetails(JSON.stringify(catalog), 'server'), { items: [item], pendingRotations: [], pendingRegistrations: [] })
  function updateFirstItem(value: typeof catalog, patch: Partial<typeof item>) {
    const first = value.items.at(0)
    if (!first) throw new Error('test fixture is missing its first item')
    Object.assign(first, patch)
  }
  for (const mutate of [
    (value: typeof catalog) => { value.target = 'production' },
    (value: typeof catalog) => { updateFirstItem(value, { serviceId: 'other' }) },
    (value: typeof catalog) => { updateFirstItem(value, { reference: '/tmp/secret' }) },
    (value: typeof catalog) => { updateFirstItem(value, { label: 'bad\nlabel' }) },
    (value: typeof catalog) => { value.items.push(item) },
  ]) {
    const candidate = structuredClone(catalog)
    mutate(candidate)
    assert.throws(() => parseServiceSecretCatalog(JSON.stringify(candidate), 'server'))
  }
})

await test('pending Core registrations remain visible as safe retry metadata', () => {
  const reference = 'ssr:v1:11112222333344445555666677778888'
  const registration = { reference, serviceId: 'server', purpose: 'http.auth.bearer', label: 'Gateway next', state: 'pending' }
  const catalog = { schemaVersion: 'service-secret-references/v1', target: 'local', serviceId: 'server', items: [], pendingRotations: [], pendingRegistrations: [registration] }
  assert.deepEqual(parseServiceSecretCatalogDetails(JSON.stringify(catalog), 'server').pendingRegistrations, [registration])
  for (const patch of [
    { ...catalog, pendingRegistrations: [{ ...registration, serviceId: 'other' }] },
    { ...catalog, pendingRegistrations: [{ ...registration, state: 'active' }] },
    { ...catalog, pendingRegistrations: [{ ...registration, secret: 'must-not-be-returned' }] },
    { ...catalog, pendingRegistrations: [registration, registration] },
  ]) assert.throws(() => parseServiceSecretCatalogDetails(JSON.stringify(patch), 'server'))
})

await test('pending rotation metadata resumes only when both active references match service and purpose', () => {
  const previous = { reference: 'ssr:v1:00112233445566778899aabbccddeeff', serviceId: 'server', purpose: 'http.auth.bearer', label: 'Gateway', state: 'active', createdAt: '2026-10-17T00:00:00Z' }
  const created = { reference: 'ssr:v1:11112222333344445555666677778888', serviceId: 'server', purpose: 'http.auth.bearer', label: 'Gateway rotated', state: 'active', createdAt: '2026-10-17T00:01:00Z' }
  const catalog = { schemaVersion: 'service-secret-references/v1', target: 'local', serviceId: 'server', items: [previous, created], pendingRotations: [{ previousReference: previous.reference, createdReference: created.reference, serviceId: 'server', purpose: 'http.auth.bearer', state: 'staged' }], pendingRegistrations: [] }
  assert.deepEqual(parseServiceSecretCatalogDetails(JSON.stringify(catalog), 'server').pendingRotations, catalog.pendingRotations)
  for (const patch of [
    { ...catalog, pendingRotations: [{ ...catalog.pendingRotations[0], serviceId: 'other' }] },
    { ...catalog, pendingRotations: [{ ...catalog.pendingRotations[0], purpose: 'other.purpose' }] },
    { ...catalog, pendingRotations: [{ ...catalog.pendingRotations[0], state: 'completed' }] },
    { ...catalog, items: [previous] },
  ]) assert.throws(() => parseServiceSecretCatalogDetails(JSON.stringify(patch), 'server'))
})

await test('rotation result exposes a staged reference without revoking or returning secret values', () => {
  const previous = { reference: 'ssr:v1:00112233445566778899aabbccddeeff', serviceId: 'server', purpose: 'http.auth.bearer', label: 'Gateway', state: 'active', createdAt: '2026-10-17T00:00:00Z' }
  const created = { reference: 'ssr:v1:11112222333344445555666677778888', serviceId: 'server', purpose: 'http.auth.bearer', label: 'Gateway rotated', state: 'active', createdAt: '2026-10-17T00:01:00Z' }
  const raw = JSON.stringify({ schemaVersion: 'service-secret-rotation-result/v1', target: 'local', serviceId: 'server', previous, created, state: 'staged' })
  assert.deepEqual(parseServiceSecretRotationResult(raw, 'server', previous.reference, previous.purpose), created)
  for (const patch of [
    { state: 'revoked' },
    { target: 'production' },
    { created: { ...created, serviceId: 'other' } },
    { created: { ...created, purpose: 'other.purpose' } },
    { created: { ...created, reference: previous.reference } },
    { created: { ...created, secret: 'must-not-be-returned' } },
  ]) {
    assert.throws(() => parseServiceSecretRotationResult(JSON.stringify({ schemaVersion: 'service-secret-rotation-result/v1', target: 'local', serviceId: 'server', previous, created, state: 'staged', ...patch }), 'server', previous.reference, previous.purpose))
  }
})

await test('rotation preview finds only exact references and renders escaped paths', () => {
  const reference = `ssr:v1:${'b'.repeat(32)}`
  const values = { config: { routes: [{ auth: { secretRef: reference } }, { auth: { secretRef: 'other' } }], 'feature/name': reference } }
  const paths = serviceSecretReferencePaths(values, reference)
  assert.deepEqual(paths, [['config', 'routes', '0', 'auth', 'secretRef'], ['config', 'feature/name']])
  assert.equal(serviceSecretJSONPointer(paths[1]), '/config/feature~1name')
})
