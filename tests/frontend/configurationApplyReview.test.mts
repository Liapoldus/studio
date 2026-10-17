import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configurationApplyReviewDiff, configurationApplyReviewPaths } from '../../frontend/src/models/configurationApplyReview.ts'

await test('public routes, listeners and security-sensitive settings require review without exposing values', () => {
  const review = configurationApplyReviewPaths({
    routes: { 'private-route-id': { handler: { auth: { secretRef: 'ssr:v1:0123456789abcdef0123456789abcdef' } } } },
    listeners: [{ address: '0.0.0.0:443' }],
    defaults: { rateLimit: { enabled: true } },
    diagnostics: { level: 'debug' },
  })
  assert.deepEqual(review, ['defaults.rateLimit', 'listeners', 'routes'])
  assert.equal(review.some((path) => path.includes('ssr:') || path.includes('private-route-id') || path.includes('0.0.0.0')), false)
})

await test('ordinary internal settings do not require an extra confirmation', () => {
  assert.deepEqual(configurationApplyReviewPaths({ logging: { level: 'debug' }, metrics: { enabled: true } }), [])
})

await test('security review persists a safe before/after summary and redacts secret and header values', () => {
  const before = {
    config: {
      routes: [{
        id: 'private-route-id',
        handler: { type: 'service', path: '/public' },
        features: {
          auth: { mode: 'disabled', secretRef: 'old-secret-reference' },
          headers: { request: { Authorization: 'Bearer old-sensitive-value' } },
          rateLimit: { mode: 'enabled', requestsPerSecond: 10 },
        },
      }],
    },
  }
  const patch = {
    config: {
      routes: {
        '0': {
          handler: { path: '/private' },
          features: {
            auth: { mode: 'enabled', secretRef: 'new-secret-reference' },
            headers: { request: { Authorization: 'Bearer new-sensitive-value' } },
            rateLimit: { requestsPerSecond: 20 },
          },
        },
      },
    },
  }
  const review = configurationApplyReviewDiff(before, patch)
  assert.ok(review.includes('config.routes.item-1.features.auth.mode: disabled to enabled'))
  assert.ok(review.includes('config.routes.item-1.features.auth.secretref: replaced (value-redacted)'))
  assert.ok(review.includes('config.routes.item-1.features.ratelimit.requestspersecond: 10 to 20'))
  assert.equal(review.some((entry) => entry.includes('old-secret-reference') || entry.includes('new-secret-reference') || entry.includes('old-sensitive-value') || entry.includes('new-sensitive-value') || entry.includes('private-route-id') || entry.includes('/private')), false)
})
