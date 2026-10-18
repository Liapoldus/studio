import assert from 'node:assert/strict'
import test from 'node:test'
import { applySavedServiceSecretRotation, replaceServiceSecretReferencesAndSave } from '../../frontend/src/controllers/serviceSecretRotation.ts'
import { configurationDraftKey } from '../../frontend/src/models/configurationDraft.ts'
import { parseDeclaredSecretPurposes, parseServiceSecretCatalog, parseServiceSecretCatalogDetails, parseServiceSecretRotationResult, serviceSecretJSONPointer, serviceSecretReferencePaths } from '../../frontend/src/models/serviceSecrets.ts'

await test('secret manager purposes are deduplicated and validated as public manifest metadata', () => {
  assert.deepEqual(parseDeclaredSecretPurposes('{"id":"server","secretPurposes":["http.auth.bearer","http.auth.bearer","server.tls.key"]}', 'server'), ['http.auth.bearer', 'server.tls.key'])
  assert.deepEqual(parseDeclaredSecretPurposes('{"id":"echo"}', 'echo'), [])
  for (const raw of [
    '{"id":"other","secretPurposes":["http.auth.bearer"]}',
    '{"id":"server","secretPurposes":"http.auth.bearer"}',
    '{"id":"server","secretPurposes":null}',
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

await test('rotation saves every reviewed reference before explicitly applying the Project configuration', async () => {
  const previous = 'ssr:v1:00112233445566778899aabbccddeeff'
  const created = 'ssr:v1:11112222333344445555666677778888'
  const values: Record<string, unknown> = { config: { routes: [{ auth: { secretRef: previous } }, { auth: { secretRef: previous } }] } }
  const paths = serviceSecretReferencePaths(values, previous)
  const calls: string[] = []
  const controller = {
    pluginReadServiceSettings: () => {
      calls.push('read')
      return Promise.resolve({ serviceId: 'server', values: structuredClone(values), patch: {}, status: 'clean', errorCode: '' })
    },
    pluginPatchServiceSettings: (_projectID: string, _serviceID: string, path: string[], value: unknown) => {
      calls.push(`patch:${JSON.stringify(path)}:${String(value)}`)
      let parent: unknown = values
      for (const segment of path.slice(0, -1)) {
        if (Array.isArray(parent)) {
          const index = Number(segment)
          if (!Number.isSafeInteger(index) || String(index) !== segment) throw new Error('invalid test path')
          parent = parent[index]
        } else if (typeof parent === 'object' && parent !== null) {
          parent = (parent as Record<string, unknown>)[segment]
        } else {
          throw new Error('invalid test path')
        }
      }
      const leaf = path.at(-1) ?? ''
      if (Array.isArray(parent)) {
        const index = Number(leaf)
        if (!Number.isSafeInteger(index) || String(index) !== leaf || index >= parent.length) throw new Error('invalid test path')
        parent[index] = value
      } else if (typeof parent === 'object' && parent !== null) {
        (parent as Record<string, unknown>)[leaf] = value
      } else {
        throw new Error('invalid test path')
      }
      return Promise.resolve({ serviceId: 'server', values: structuredClone(values), patch: {}, status: 'dirty', errorCode: '' })
    },
    pluginSaveServiceSettings: () => {
      calls.push('save-project')
      return Promise.resolve({ serviceId: 'server', values: structuredClone(values), patch: {}, status: 'clean', errorCode: '' })
    },
    applyServiceSettings: (key: string) => { calls.push(`apply:${key}`); return Promise.resolve() },
    retryFailedServiceSettings: (key: string) => { calls.push(`retry-failed:${key}`); return Promise.resolve() },
  } as unknown as Parameters<typeof replaceServiceSecretReferencesAndSave>[0]

  await replaceServiceSecretReferencesAndSave(controller, 'project-1', 'server', previous, created, paths)
  assert.deepEqual(calls, [
    'read',
    `patch:${JSON.stringify(paths[0])}:${created}`,
    `patch:${JSON.stringify(paths[1])}:${created}`,
    'save-project',
  ])
  assert.equal(serviceSecretReferencePaths(values, previous).length, 0)
  assert.equal(serviceSecretReferencePaths(values, created).length, paths.length)

  await applySavedServiceSecretRotation(controller, 'project-1', '/project-1', 'server', previous, created)
  assert.equal(calls.at(-2), 'read')
  assert.equal(calls.at(-1), `apply:${configurationDraftKey('/project-1', 'server')}`)

  await applySavedServiceSecretRotation(controller, 'project-1', '/project-1', 'server', previous, created, true)
  assert.equal(calls.at(-2), 'read')
  assert.equal(calls.at(-1), `retry-failed:${configurationDraftKey('/project-1', 'server')}`)
})

await test('rotation refuses stale reviewed paths and never applies a Project that still uses the old reference', async () => {
  const previous = 'ssr:v1:00112233445566778899aabbccddeeff'
  const created = 'ssr:v1:11112222333344445555666677778888'
  const current = { auth: { secretRef: previous } }
  let patches = 0
  let applies = 0
  const controller = {
    pluginReadServiceSettings: () => Promise.resolve({ serviceId: 'server', values: structuredClone(current), patch: {}, status: 'clean', errorCode: '' }),
    pluginPatchServiceSettings: () => { patches += 1; return Promise.resolve({ serviceId: 'server', values: current, patch: {}, status: 'dirty', errorCode: '' }) },
    pluginSaveServiceSettings: () => Promise.resolve({ serviceId: 'server', values: current, patch: {}, status: 'clean', errorCode: '' }),
    applyServiceSettings: () => { applies += 1; return Promise.resolve() },
  } as unknown as Parameters<typeof replaceServiceSecretReferencesAndSave>[0]

  await assert.rejects(replaceServiceSecretReferencesAndSave(controller, 'project-1', 'server', previous, created, [['wrong', 'path']]), /secret_rotation_project_changed/u)
  await assert.rejects(applySavedServiceSecretRotation(controller, 'project-1', '/project-1', 'server', previous, created), /secret_rotation_project_not_ready/u)
  assert.equal(patches, 0)
  assert.equal(applies, 0)
})
