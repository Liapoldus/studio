import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  configurationSchemaArrayItem,
  configurationSchemaCanCreateProtectedArrayItem,
  configurationSchemaVariants,
  configurationSchemaChild,
  configurationSchemaProtected,
  configurationSchemaRenderable,
  configurationVariantValue,
  createConfigurationSchemaValue,
  effectiveConfigurationSchema,
  resolveConfigurationSchema,
  selectedConfigurationVariant,
} from '../../frontend/src/models/configurationSchema.ts'

await test('array item schemas resolve local references used by service contracts', () => {
  const schema = {
    $defs: { hostname: { type: 'string', minLength: 1, maxLength: 253 } },
    type: 'object',
    properties: {
      hostnames: { type: 'array', items: { $ref: '#/$defs/hostname' } },
    },
  }
  const hostnames = (schema.properties as Record<string, unknown>).hostnames
  assert.deepEqual(configurationSchemaArrayItem(schema, hostnames), schema.$defs.hostname)
  assert.equal(configurationSchemaRenderable(schema, hostnames, ['api.example.test']), true)
})

await test('protected array items can be added from safe defaults unless a required protected value cannot be initialized', () => {
  const optionalSecretRoot = {
    type: 'object',
    properties: {},
    $defs: {
      listener: {
        type: 'object',
        required: ['id', 'address'],
        properties: {
          id: { type: 'string' },
          address: { type: 'string' },
          credentialRef: { type: ['string', 'null'], 'x-sensitive': true },
          certificateRef: { type: 'string', format: 'resource', 'x-liapoldus-resource': 'certificate' },
        },
      },
    },
  }
  const listenerRef = { $ref: '#/$defs/listener' }
  assert.equal(configurationSchemaCanCreateProtectedArrayItem(optionalSecretRoot, listenerRef), true)

  const requiredSecretRoot = {
    $defs: { listener: {
      type: 'object',
      required: ['id', 'privateKey'],
      properties: {
        id: { type: 'string' },
        privateKey: { type: 'string', 'x-secret': true },
      },
    } },
  }
  assert.equal(configurationSchemaCanCreateProtectedArrayItem(requiredSecretRoot, { $ref: '#/$defs/listener' }), false)
})

await test('protected array Add is disabled when a required generated field has no renderer', () => {
  const schema = {
    type: 'array',
    items: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'unsupported-studio-control' },
        signingSecret: { type: 'string', 'x-sensitive': true },
      },
    },
  }
  const item = schema.items
  const value = createConfigurationSchemaValue(schema, item)
  assert.deepEqual(value, { id: '' })
  assert.equal(configurationSchemaCanCreateProtectedArrayItem(schema, item), false)
  const renderedPaths: string[][] = []
  assert.equal(configurationSchemaCanCreateProtectedArrayItem(schema, item, (_field, _current, path) => {
    renderedPaths.push(path)
    return path.join('/') === 'id'
  }), true)
  assert.deepEqual(renderedPaths, [['id']])
})

await test('configuration schemas resolve bounded local references only', () => {
  const root = { $defs: { address: { type: 'object', properties: { host: { type: 'string' } } } } }
  assert.equal(resolveConfigurationSchema(root, { $ref: '#/$defs/address' })?.type, 'object')
  assert.equal(resolveConfigurationSchema(root, { $ref: 'https://example.invalid/schema.json' }), null)
  assert.equal(resolveConfigurationSchema(root, { $ref: '#/$defs/missing' }), null)
  const cyclic = { $defs: { node: { $ref: '#/$defs/node' } } }
  assert.equal(resolveConfigurationSchema(cyclic, { $ref: '#/$defs/node' }), null)
})

await test('oneOf exposes the unique discriminator branch and safe branch defaults', () => {
  const schema = { oneOf: [
    { type: 'object', required: ['type', 'address'], properties: { type: { const: 'static' }, address: { type: 'string' } } },
    { type: 'object', required: ['type', 'upstreams'], properties: { type: { const: 'reverseProxy' }, upstreams: { type: 'array', items: { type: 'string' } } } },
  ] }
  const variants = configurationSchemaVariants(schema, schema)
  assert.ok(variants)
  assert.equal(variants.length, 2)
  assert.equal(selectedConfigurationVariant(schema, variants, { type: 'reverseProxy', upstreams: [] })?.index, 1)
  assert.equal(selectedConfigurationVariant(schema, variants, { type: 'reverseProxy' })?.index, 1)
  const firstVariant = variants[0]
  assert.ok(firstVariant)
  assert.deepEqual(createConfigurationSchemaValue(schema, firstVariant.schema), { type: 'static', address: '' })
  assert.deepEqual(configurationVariantValue(schema, schema, { type: 'static', address: '/home', obsolete: true }, 1), {
    ok: true,
    value: { type: 'reverseProxy', upstreams: [] },
  })
  const protectedSchema = { oneOf: [
    { type: 'object', properties: { mode: { const: 'safe' } } },
    { type: 'object', properties: { mode: { const: 'secret' }, privateKey: { type: 'string' } } },
  ] }
  assert.deepEqual(configurationVariantValue(protectedSchema, protectedSchema, { mode: 'safe' }, 1), { ok: false })
})

await test('protected object rows choose a safe oneOf default without exposing secret-only variants', () => {
  const schema = {
    $defs: {
      tls: { oneOf: [
        { $ref: '#/$defs/automatic' },
        { $ref: '#/$defs/custom' },
        { $ref: '#/$defs/disabled' },
      ] },
      automatic: { type: 'object', required: ['mode'], properties: { mode: { const: 'automatic' } } },
      custom: { type: 'object', required: ['mode', 'privateKeyRef'], properties: { mode: { const: 'custom' }, privateKeyRef: { type: 'string' } } },
      disabled: { type: 'object', required: ['mode'], properties: { mode: { const: 'disabled' } } },
      listener: { type: 'object', required: ['id', 'tls', 'hostnames'], properties: {
        id: { type: 'string', minLength: 1 },
        tls: { $ref: '#/$defs/tls' },
        hostnames: {
          type: 'array', items: { type: 'string', minLength: 1 },
          allOf: [{ if: { type: 'object' }, else: { type: 'array', minItems: 1 } }],
        },
      } },
    },
    type: 'array',
    items: { $ref: '#/$defs/listener' },
  }
  const listener = { $ref: '#/$defs/listener' }
  const template = createConfigurationSchemaValue(schema, listener) as Record<string, unknown>
  assert.deepEqual(template, { id: '', tls: { mode: 'automatic' }, hostnames: [] })
  assert.equal(configurationSchemaProtected(schema, listener), true)
  assert.equal(configurationSchemaCanCreateProtectedArrayItem(schema, listener), true)
  const tls = schema.$defs.tls
  assert.deepEqual(configurationVariantValue(schema, tls, template.tls, 1), { ok: false })
  assert.deepEqual(configurationVariantValue(schema, tls, template.tls, 2), { ok: true, value: { mode: 'disabled' } })
})

await test('allOf fields and required constraints follow matching if/then/else branches', () => {
  const schema = {
    type: 'object',
    properties: { mode: { enum: ['automatic', 'custom'] } },
    allOf: [{
      if: { type: 'object', properties: { mode: { const: 'custom' } }, required: ['mode'] },
      then: { properties: { certificateRef: { type: 'string' } }, required: ['certificateRef'] },
      else: { properties: { hostnames: { type: 'array' } } },
    }],
  }
  const custom = effectiveConfigurationSchema(schema, schema, { mode: 'custom' })
  const automatic = effectiveConfigurationSchema(schema, schema, { mode: 'automatic' })
  assert.ok(custom)
  assert.ok(automatic)
  const customProperties = custom.properties as Record<string, unknown>
  const automaticProperties = automatic.properties as Record<string, unknown>
  assert.equal(typeof customProperties.certificateRef, 'object')
  assert.deepEqual(custom.required, ['certificateRef'])
  assert.equal(typeof automaticProperties.hostnames, 'object')
  assert.equal(Object.hasOwn(automaticProperties, 'certificateRef'), false)
})

await test('unsupported open JSON shapes fail closed per field without invalidating safe siblings', () => {
  const schema = { type: 'object', properties: {
    enabled: { type: 'boolean' },
    requestSchema: { type: 'object', additionalProperties: true },
  } }
  const properties = schema.properties
  assert.equal(configurationSchemaRenderable(schema, properties.enabled, false), true)
  assert.equal(configurationSchemaRenderable(schema, properties.requestSchema, { type: 'object', properties: {} }), false)
  assert.equal(configurationSchemaRenderable(schema, schema, { enabled: true, requestSchema: {} }), false)
})

await test('explicit JSON document fields render while unmarked open objects remain fail-closed', () => {
  const schema = { type: 'object', properties: {
    document: { type: 'object', additionalProperties: true, 'x-studio-json-document': true },
    example: { 'x-studio-json-value': true },
    unconstrained: {},
    arbitrary: { type: 'object', additionalProperties: true },
  } }
  const properties = schema.properties
  assert.equal(configurationSchemaRenderable(schema, properties.document, { nested: [{ enabled: true }] }), true)
  assert.equal(configurationSchemaRenderable(schema, properties.document, {}), true)
  assert.equal(configurationSchemaRenderable(schema, properties.example, 'text example'), true)
  assert.equal(configurationSchemaRenderable(schema, properties.example, null), true)
  assert.equal(configurationSchemaRenderable(schema, properties.unconstrained, 'text example'), true)
  assert.equal(configurationSchemaRenderable(schema, properties.unconstrained, null), true)
  assert.equal(configurationSchemaRenderable(schema, properties.unconstrained, { nested: [1, true] }), true)
  assert.equal(configurationSchemaProtected(schema, properties.document), false)
  assert.equal(configurationSchemaProtected(schema, properties.example), false)
  assert.equal(configurationSchemaRenderable(schema, properties.arbitrary, {}), false)
})

await test('explicit JSON document/value fields do not block safe array row creation', () => {
  const schema = { type: 'array', items: {
    type: 'object',
    required: ['schema', 'example'],
    properties: {
      schema: { type: 'object', additionalProperties: true, 'x-studio-json-document': true },
      example: { 'x-studio-json-value': true },
    },
  } }
  assert.equal(configurationSchemaProtected(schema, schema.items), false)
  assert.deepEqual(createConfigurationSchemaValue(schema, schema.items), { schema: {}, example: null })
  assert.equal(configurationSchemaCanCreateProtectedArrayItem(schema, schema), true)
})

await test('typed additional properties expose bounded map fields while open and pattern maps fail closed', () => {
  const schema = { type: 'object', properties: { labels: { type: 'object', maxProperties: 4, additionalProperties: { type: 'integer', minimum: 0 } } } }
  const labels = (schema.properties as Record<string, unknown>).labels
  assert.equal((configurationSchemaChild(schema, labels, 'zone') as Record<string, unknown>).type, 'integer')
  assert.equal(configurationSchemaRenderable(schema, labels, { east: 2, west: 3 }), true)
  assert.equal(configurationSchemaRenderable(schema, labels, { tokenValue: 2 }), true)
  assert.equal(configurationSchemaRenderable(schema, { type: 'object', additionalProperties: true }, { east: 2 }), false)
  assert.equal(configurationSchemaRenderable(schema, { type: 'object', additionalProperties: { type: 'string' }, patternProperties: { '^x-': { type: 'string' } } }, { east: '1' }), false)
  assert.equal(configurationSchemaRenderable(schema, { type: 'object', additionalProperties: { type: 'string' }, propertyNames: { pattern: '^[a-z]+$' } }, { east: '1' }), false)
  assert.equal(configurationSchemaRenderable(schema, { type: 'object', additionalProperties: { type: 'string', writeOnly: true } }, { east: 'hidden' }), false)
})

