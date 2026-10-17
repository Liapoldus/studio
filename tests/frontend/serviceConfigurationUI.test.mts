import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configurationSchemaDifferencePaths, configurationSchemasMatch, matchServiceConfigurationUIField, parseCompatiblePeerService, parseServiceConfigurationUI, pointerSegments, projectCertificateCanImport, projectResourceCanOpen, schemaAtPointer, supportsServiceResourceCatalog } from '../../frontend/src/models/serviceConfigurationUI.ts'

const schema = {
  type: 'object',
  properties: {
    address: { type: 'string' },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    enabled: { type: 'boolean' },
    token: { type: 'string', writeOnly: true },
    routes: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' } } } },
  },
}

function manifest(configurationUI: unknown, resources: unknown[] = []): string {
  return JSON.stringify({
    id: 'server',
    peerContracts: [{ id: 'catalog.v1' }],
    resources,
    configurationUI,
  })
}

await test('accepts SDK configuration UI metadata only when paths and widgets match schema', () => {
  const result = parseServiceConfigurationUI(manifest({
    version: 'service-configuration-ui/v1',
    groups: [{
      id: 'listener', title: { ru: 'Слушатель', en: 'Listener' }, order: 2,
      fields: [
        { path: '/port', label: { ru: 'Порт', en: 'Port' }, widget: 'slider', order: 1, unit: { ru: 'порт', en: 'port' } },
        { path: '/address', label: { ru: 'Адрес', en: 'Address' }, widget: 'text', order: 0 },
      ],
    }],
  }), schema)
  assert.ok(result)
  const group = result.groups[0]
  assert.ok(group)
  assert.equal(group.title.en, 'Listener')
  assert.deepEqual(group.fields.map((field) => field.path), ['/address', '/port'])
  assert.deepEqual(group.fields[1]?.segments, ['port'])
})

await test('fails closed on bad versions, unknown paths, sensitive fields and incompatible widgets', () => {
  const group = (path: string, widget = 'text') => ({ version: 'service-configuration-ui/v1', groups: [{ id: 'g', title: { ru: 'Параметры', en: 'Settings' }, fields: [{ path, label: { ru: 'Поле', en: 'Field' }, widget }] }] })
  assert.equal(parseServiceConfigurationUI(manifest({ version: 'future/v9', groups: [] }), schema), null)
  assert.equal(parseServiceConfigurationUI(manifest(group('/missing')), schema), null)
  assert.equal(parseServiceConfigurationUI(manifest(group('/token')), schema), null)
  assert.equal(parseServiceConfigurationUI(manifest(group('/privateKeyRef')), { type: 'object', properties: { privateKeyRef: { type: 'string' } } }), null)
  assert.equal(parseServiceConfigurationUI(manifest(group('/port', 'text')), schema), null)
  assert.equal(parseServiceConfigurationUI(manifest({ ...group('/port', 'slider'), groups: [{ id: 'g', title: { ru: 'Группа', en: 'Group' }, order: -1, fields: [{ path: '/port', label: { ru: 'Порт', en: 'Port' }, widget: 'slider' }] }] }), schema), null)
  assert.deepEqual(parseServiceConfigurationUI(manifest(group('/routes/*/path')), schema)?.groups[0]?.fields[0]?.segments, ['routes', '*', 'path'])
})

await test('validates JSON Pointer escaping and resolves nested schema fields', () => {
  assert.deepEqual(pointerSegments('/route~1name/value~0suffix'), ['route/name', 'value~suffix'])
  assert.equal(pointerSegments('/invalid~2escape'), null)
  assert.equal(schemaAtPointer(schema, ['routes', '*', 'path'])?.type, 'string')
})

await test('SDK UI fields resolve local references and discriminator variants', () => {
  const referenced = {
    type: 'object',
    $defs: { transport: { oneOf: [
      { type: 'object', properties: { mode: { const: 'automatic' } } },
      { type: 'object', properties: { mode: { const: 'disabled' } } },
    ] } },
    properties: { listener: { properties: { transport: { $ref: '#/$defs/transport' } } } },
  }
  assert.equal(schemaAtPointer(referenced, ['listener', 'transport', 'mode'])?.anyOf instanceof Array, true)
  const descriptor = parseServiceConfigurationUI(manifest({ version: 'service-configuration-ui/v1', groups: [
    { id: 'transport', title: { ru: 'Транспорт', en: 'Transport' }, order: 0, fields: [
      { path: '/listener/transport/mode', label: { ru: 'Режим', en: 'Mode' }, widget: 'select', order: 0 },
    ] },
  ] }), referenced)
  assert.equal(descriptor?.groups[0]?.fields[0]?.path, '/listener/transport/mode')
})

await test('peer UI hints require a declared contract and a string service-id field', () => {
  const peerSchema = { type: 'object', properties: { peer: { type: 'string' }, objectPeer: { type: 'object', properties: { serviceId: { type: 'string' } } } } }
  const descriptor = (path: string) => ({ version: 'service-configuration-ui/v1', groups: [{
    id: 'peers', title: { ru: 'Связи', en: 'Peers' }, fields: [
      { path, label: { ru: 'Сервис', en: 'Service' }, widget: 'peer', peerContractId: 'catalog.v1' },
    ],
  }] })
  const accepted = parseServiceConfigurationUI(manifest(descriptor('/peer')), peerSchema)
  assert.equal(accepted?.groups[0]?.fields[0]?.peerContractId, 'catalog.v1')
  const unknownContract = { version: 'service-configuration-ui/v1', groups: [{
    id: 'peers', title: { ru: 'Связи', en: 'Peers' }, fields: [
      { path: '/peer', label: { ru: 'Сервис', en: 'Service' }, widget: 'peer', peerContractId: 'missing.v1' },
    ],
  }] }
  assert.equal(parseServiceConfigurationUI(manifest(unknownContract), peerSchema), null)
  assert.equal(parseServiceConfigurationUI(manifest(descriptor('/peer'), []), peerSchema)?.groups[0]?.fields[0]?.widget, 'peer')
  assert.equal(parseServiceConfigurationUI(manifest({ ...descriptor('/objectPeer'), groups: [{
    id: 'peers', title: { ru: 'Связи', en: 'Peers' }, fields: [
      { path: '/objectPeer', label: { ru: 'Сервис', en: 'Service' }, widget: 'peer', peerContractId: 'catalog.v1' },
    ],
  }] }), peerSchema), null)
})

await test('peer picker accepts only the exact service manifest and declared contract', () => {
  const document = JSON.stringify({ id: 'echo', version: '1.2.1', peerContracts: [{ id: 'catalog.v1', version: '2.0.0' }] })
  assert.deepEqual(parseCompatiblePeerService(document, 'echo', 'catalog.v1'), { id: 'echo', version: '1.2.1', contractVersion: '2.0.0' })
  assert.equal(parseCompatiblePeerService(document, 'server', 'catalog.v1'), null)
  assert.equal(parseCompatiblePeerService(document, 'echo', 'other.v1'), null)
  assert.equal(parseCompatiblePeerService(JSON.stringify({ id: 'echo', version: '1.2.1', peerContracts: [] }), 'echo', 'catalog.v1'), null)
  assert.equal(parseCompatiblePeerService('x'.repeat(262_145), 'echo', 'catalog.v1'), null)
})

await test('reconciles Project schema with Core live schema independent of object key order', () => {
  assert.equal(configurationSchemasMatch(schema, JSON.stringify({
    properties: {
      routes: { items: { properties: { path: { type: 'string' } }, type: 'object' }, type: 'array' },
      enabled: { type: 'boolean' }, token: { writeOnly: true, type: 'string' },
      port: { maximum: 65535, minimum: 1, type: 'integer' }, address: { type: 'string' },
    },
    type: 'object',
  })), true)
  assert.equal(configurationSchemasMatch(schema, JSON.stringify({ ...schema, properties: { ...schema.properties, port: { ...schema.properties.port, maximum: 65534 } } })), false)
  assert.deepEqual(configurationSchemaDifferencePaths(schema, JSON.stringify({ ...schema, properties: { ...schema.properties, port: { ...schema.properties.port, maximum: 65534 } } })), ['/properties/port/maximum'])
  assert.equal(configurationSchemasMatch(schema, '[]'), false)
  assert.equal(configurationSchemasMatch(schema, '{"type":"object","properties":{"port":{"type":"number","minimum":1e999}}}'), false)
  assert.equal(configurationSchemasMatch({ type: 'object', minimum: Number.MAX_SAFE_INTEGER + 2 }, '{"minimum":9007199254740993,"type":"object"}'), false)
  assert.equal(configurationSchemasMatch({ type: 'object', minimum: 0 }, '{"minimum":-0,"type":"object"}'), true)
  assert.equal(configurationSchemasMatch(schema, 'x'.repeat(1_048_577)), false)
})

await test('schema reconciliation treats local JSON Schema refs and Core-expanded schemas as equivalent', () => {
  const projectSchema = { $defs: { listener: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } }, type: 'object', properties: { listener: { $ref: '#/$defs/listener' } } }
  const coreExpandedSchema = { type: 'object', properties: { listener: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } }, $defs: { listener: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } } }
  assert.equal(configurationSchemasMatch(projectSchema, JSON.stringify(coreExpandedSchema)), true)
  assert.deepEqual(configurationSchemaDifferencePaths(projectSchema, JSON.stringify(coreExpandedSchema)), [])
})

await test('applies the most specific wildcard descriptor to concrete array items', () => {
  const parsed = parseServiceConfigurationUI(manifest({
    version: 'service-configuration-ui/v1',
    groups: [{ id: 'routes', title: { ru: 'Маршруты', en: 'Routes' }, fields: [
      { path: '/routes/*/path', label: { ru: 'Путь', en: 'Path' }, widget: 'text' },
      { path: '/routes/*/query/*/name', label: { ru: 'Имя параметра', en: 'Parameter name' }, widget: 'text' },
      { path: '/enabled', label: { ru: 'Включено', en: 'Enabled' }, widget: 'toggle' },
    ] }],
  }), {
    type: 'object', properties: { enabled: { type: 'boolean' }, routes: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, query: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    } } } },
  })
  assert.ok(parsed)
  assert.equal(matchServiceConfigurationUIField(parsed, ['routes', '0', 'path'])?.widget, 'text')
  assert.equal(matchServiceConfigurationUIField(parsed, ['routes', '0', 'query', '1', 'name'])?.label.en, 'Parameter name')
  assert.equal(matchServiceConfigurationUIField(parsed, ['enabled'])?.widget, 'toggle')
  assert.equal(matchServiceConfigurationUIField(parsed, ['routes', '0', 'missing']), null)
})

await test('binds resource widgets only to safe manifest-declared catalogs', () => {
  const resource = { id: 'sites', kind: 'site', provider: 'service-admin', pageId: 'sites', queryResource: 'sites', valuePointer: '/siteId', labelPointer: '/siteId' }
  const descriptor = { version: 'service-configuration-ui/v1', groups: [{ id: 'site', title: { ru: 'Сайт', en: 'Site' }, fields: [
    { path: '/siteId', label: { ru: 'Сайт', en: 'Site' }, widget: 'resource', resourceKind: 'site', resourceId: 'sites' },
  ] }] }
  const parsed = parseServiceConfigurationUI(manifest(descriptor, [resource]), { type: 'object', properties: { siteId: { type: 'string' } } })
  assert.equal(parsed?.resources[0]?.provider, 'service-admin')
  assert.equal(parsed.groups[0]?.fields[0]?.resourceId, 'sites')
  assert.equal(parseServiceConfigurationUI(manifest(descriptor), { type: 'object', properties: { siteId: { type: 'string' } } }), null)
  assert.equal(parseServiceConfigurationUI(manifest(descriptor, [{ ...resource, id: 'sites', valuePointer: '/privateKeyRef' }]), { type: 'object', properties: { siteId: { type: 'string' } } }), null)
  assert.equal(parseServiceConfigurationUI(manifest({ ...descriptor, groups: [{ ...descriptor.groups[0], fields: [{ ...descriptor.groups[0].fields[0], resourceKind: 'artifact' }] }] }, [resource]), { type: 'object', properties: { siteId: { type: 'string' } } }), null)
})

await test('opens only selected Project-backed file resources that still exist in the host file index', () => {
  const catalog = [{ value: 'resources/public.json' }]
  const files = [{ path: 'resources/public.json', kind: 'file' }]
  assert.equal(projectResourceCanOpen('project', 'file', 'resources/public.json', catalog, files), true)
  assert.equal(projectResourceCanOpen('service-admin', 'file', 'resources/public.json', catalog, files), false)
  assert.equal(projectResourceCanOpen('project', 'artifact', 'resources/public.json', catalog, files), false)
  assert.equal(projectResourceCanOpen('project', 'file', 'resources/private.pem', catalog, files), false)
  assert.equal(projectResourceCanOpen('project', 'file', '../outside', [{ value: '../outside' }], [{ path: '../outside', kind: 'file' }]), false)
  assert.equal(projectResourceCanOpen('project', 'file', 'resources/missing.json', catalog, files), false)
  assert.equal(projectResourceCanOpen('project', 'file', 'resources/public.json', catalog, [{ path: 'resources/public.json', kind: 'directory' }]), false)
})

await test('certificate import is available only for Project-owned certificate catalogs', () => {
  assert.equal(projectCertificateCanImport('project', 'certificate'), true)
  assert.equal(projectCertificateCanImport('project', 'file'), false)
  assert.equal(projectCertificateCanImport('service-admin', 'certificate'), false)
})

await test('enables both host-owned Project catalogs and Core-backed service catalogs', () => {
  assert.equal(supportsServiceResourceCatalog('project'), true)
  assert.equal(supportsServiceResourceCatalog('service-admin'), true)
  assert.equal(supportsServiceResourceCatalog('remote'), false)
  const fileResource = { id: 'project-files', kind: 'file', provider: 'project' }
  const descriptor = { version: 'service-configuration-ui/v1', groups: [{ id: 'files', title: { ru: 'Файлы', en: 'Files' }, fields: [
    { path: '/config/fileRef', label: { ru: 'Файл', en: 'File' }, widget: 'resource', resourceKind: 'file', resourceId: 'project-files' },
  ] }] }
  const parsed = parseServiceConfigurationUI(manifest(descriptor, [fileResource]), { type: 'object', properties: { config: { type: 'object', properties: { fileRef: { type: 'string' } } } } })
  assert.equal(parsed?.resources[0]?.provider, 'project')
})
