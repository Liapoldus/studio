import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCoreSettingsView } from '../../frontend/src/models/coreSettings.ts'

type Fixture = {
  schemaVersion: string
  target: string
  desiredRevision: number
  effectiveRevision: number
  pending: boolean
  restartRequired: boolean
  settings: { management: { listen: string; maxBodyBytes: number; headerTimeout: string; requestTimeout: string; tls: { certificate: string } }; secretRoot: string }
}

const valid: Fixture = {
  schemaVersion: 'core-settings-view/v1',
  target: 'local',
  desiredRevision: 8,
  effectiveRevision: 8,
  pending: false,
  restartRequired: false,
  settings: {
    management: {
      listen: '0.0.0.0:18180',
      maxBodyBytes: 1048576,
      headerTimeout: '5s',
      requestTimeout: '30s',
      tls: { certificate: '/private/tls/server.crt' },
    },
    secretRoot: '/private/secrets',
  },
}

await test('Core settings view projects only the redacted UI allowlist', () => {
  const view = parseCoreSettingsView(JSON.stringify(valid))
  assert.deepEqual(view, {
    schemaVersion: 'core-settings-view/v1',
    target: 'local',
    desiredRevision: 8,
    effectiveRevision: 8,
    pending: false,
    restartRequired: false,
    settings: { management: { listen: '0.0.0.0:18180', maxBodyBytes: 1048576, headerTimeout: '5s', requestTimeout: '30s' } },
  })
  assert.equal(JSON.stringify(view).includes('/private'), false)
})

await test('Core settings view rejects invalid revision, target and unbounded values', () => {
  for (const mutate of [
    (value: Fixture) => { value.target = 'production' },
    (value: Fixture) => { value.effectiveRevision = value.desiredRevision + 1 },
    (value: Fixture) => { value.settings.management.maxBodyBytes = 0 },
    (value: Fixture) => { value.settings.management.headerTimeout = '5s\nsecret' },
    (value: Fixture) => { value.settings.management.listen = 'x'.repeat(300) },
  ]) {
    const value = structuredClone(valid)
    mutate(value)
    assert.throws(() => parseCoreSettingsView(JSON.stringify(value)))
  }
})
