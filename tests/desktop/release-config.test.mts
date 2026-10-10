import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateReleaseConfig } from '../../scripts/desktop/verify-release-config.mts'

await test('release policy requires signatures, trust roots and required sandbox', () => {
  assert.deepEqual(validateReleaseConfig({
    STUDIO_PLUGIN_REQUIRE_SIGNATURES: 'true',
    STUDIO_PLUGIN_SANDBOX_MODE: 'required',
    STUDIO_PLUGIN_TRUST_ROOTS: 'release-key=redacted-public-key',
  }), [])
})

await test('release policy reports every missing or unsafe setting without exposing secrets', () => {
  assert.deepEqual(validateReleaseConfig({
    STUDIO_PLUGIN_REQUIRE_SIGNATURES: 'false',
    STUDIO_PLUGIN_SANDBOX_MODE: 'best-effort',
    STUDIO_PLUGIN_TRUST_ROOTS: '   ',
  }), [
    'STUDIO_PLUGIN_REQUIRE_SIGNATURES must be true',
    'STUDIO_PLUGIN_SANDBOX_MODE must be required',
    'STUDIO_PLUGIN_TRUST_ROOTS must be set',
  ])
})
