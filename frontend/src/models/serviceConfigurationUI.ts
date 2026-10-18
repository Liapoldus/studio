import { asConfigurationObject, isSensitiveConfigurationFieldName } from './configurationDraft'
import { configurationSchemaArrayItem, configurationSchemaChild, configurationSchemaProtected, effectiveConfigurationSchema, resolveConfigurationSchema } from './configurationSchema.js'

export type LocalizedConfigurationText = { ru: string; en: string }

export type ServiceConfigurationUIField = {
  path: string
  label: LocalizedConfigurationText
  help?: LocalizedConfigurationText
  unit?: LocalizedConfigurationText
  widget: 'auto' | 'text' | 'textarea' | 'number' | 'slider' | 'toggle' | 'select' | 'array' | 'resource' | 'peer' | 'secret'
  resourceKind?: 'file' | 'certificate' | 'site' | 'site-release' | 'artifact'
  resourceId?: string
  peerContractId?: string
  secretPurpose?: string
  order: number
  segments: string[]
}

export type ServiceConfigurationResource = {
  id: string
  kind: 'file' | 'certificate' | 'site' | 'site-release' | 'artifact'
  provider: 'project' | 'service-admin'
  pageId?: string
  queryResource?: string
  valuePointer?: string
  labelPointer?: string
}

export type CompatiblePeerService = { id: string; version: string; contractVersion: string }

export type ServiceConfigurationUIGroup = {
  id: string
  title: LocalizedConfigurationText
  description?: LocalizedConfigurationText
  order: number
  fields: ServiceConfigurationUIField[]
}

export type ServiceConfigurationUI = {
  version: 'service-configuration-ui/v1'
  groups: ServiceConfigurationUIGroup[]
  resources: ServiceConfigurationResource[]
}

export function supportsServiceResourceCatalog(provider: string): provider is ServiceConfigurationResource['provider'] {
  return provider === 'project' || provider === 'service-admin'
}

export function projectCertificateCanImport(provider: string, kind: string): boolean {
  return provider === 'project' && kind === 'certificate'
}

export function projectResourceCanOpen(provider: string, kind: string, value: string, catalog: readonly { value: string }[], files: readonly { path: string; kind: string }[]): boolean {
  if (provider !== 'project' || (kind !== 'file' && kind !== 'certificate') || value.length === 0 || value.length > 512 || value.startsWith('/') || value.includes('\\') || /[\0\r\n\p{Cc}]/u.test(value)) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.'))) return false
  return catalog.some((item) => item.value === value) && files.some((file) => file.path === value && file.kind === 'file')
}

/** Validates Core-backed manifest metadata before a peer picker commits a service ID. */
export function parseCompatiblePeerService(manifestJSON: string, expectedServiceID: string, contractID: string): CompatiblePeerService | null {
  if (manifestJSON.length > maxManifestBytes || !identifier.test(expectedServiceID) || !identifier.test(contractID)) return null
  try {
    const manifest = objectValue(JSON.parse(manifestJSON) as unknown)
    if (!manifest || manifest.id !== expectedServiceID || typeof manifest.version !== 'string' || !identifier.test(manifest.version) ||
        !Array.isArray(manifest.peerContracts) || manifest.peerContracts.length > 256) return null
    const matching = manifest.peerContracts.filter((value) => objectValue(value)?.id === contractID)
    if (matching.length !== 1) return null
    const contract = objectValue(matching[0])
    if (!contract || typeof contract.version !== 'string' || !identifier.test(contract.version)) return null
    return { id: expectedServiceID, version: manifest.version, contractVersion: contract.version }
  } catch {
    return null
  }
}

const maxManifestBytes = 262_144
const maxGroups = 128
const maxFields = 2048
const widgets = new Set<ServiceConfigurationUIField['widget']>(['auto', 'text', 'textarea', 'number', 'slider', 'toggle', 'select', 'array', 'resource', 'peer', 'secret'])
const resourceKinds = new Set(['file', 'certificate', 'site', 'site-release', 'artifact'])
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const secretPurposePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u

/**
 * Confirms that the Project's editable schema is the same contract currently
 * reported by Core for the running service. Object-key order is irrelevant;
 * array order and every schema value remain significant.
 */
export function configurationSchemasMatch(projectSchema: Record<string, unknown>, liveSchemaJSON: string): boolean {
  try {
    if (new TextEncoder().encode(liveSchemaJSON).byteLength > 1_048_576) return false
    const liveSchema = asConfigurationObject(JSON.parse(liveSchemaJSON) as unknown)
    if (!liveSchema || !safeSchemaNumbers(projectSchema) || !safeSchemaNumbers(liveSchema)) return false
    const normalizedProject = normalizeSchemaReferences(projectSchema, projectSchema)
    const normalizedLive = normalizeSchemaReferences(liveSchema, liveSchema)
    return Boolean(normalizedProject && normalizedLive && jsonEqual(normalizedProject, normalizedLive))
  } catch {
    return false
  }
}

/** Returns bounded JSON Pointers for safe schema drift diagnostics (never values). */
export function configurationSchemaDifferencePaths(projectSchema: Record<string, unknown>, liveSchemaJSON: string, limit = 24): string[] {
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 64 || new TextEncoder().encode(liveSchemaJSON).byteLength > 1_048_576) return []
    const liveSchema = asConfigurationObject(JSON.parse(liveSchemaJSON) as unknown)
    if (!liveSchema || !safeSchemaNumbers(projectSchema) || !safeSchemaNumbers(liveSchema)) return []
    const differences: string[] = []
    function compare(left: unknown, right: unknown, path: string, depth: number): void {
      if (differences.length >= limit || depth > 64 || jsonEqual(left, right)) return
      const leftObject = objectValue(left)
      const rightObject = objectValue(right)
      if (leftObject && rightObject) {
        for (const key of [...new Set([...Object.keys(leftObject), ...Object.keys(rightObject)])].sort()) {
          if (differences.length >= limit) return
          compare(leftObject[key], rightObject[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, depth + 1)
        }
        return
      }
      if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) differences.push(`${path || '/'} (array length)`)
        for (let index = 0; index < Math.min(left.length, right.length) && differences.length < limit; index++) compare(left[index], right[index], `${path}/${String(index)}`, depth + 1)
        return
      }
      differences.push(path || '/')
    }
    const normalizedProject = normalizeSchemaReferences(projectSchema, projectSchema)
    const normalizedLive = normalizeSchemaReferences(liveSchema, liveSchema)
    if (!normalizedProject || !normalizedLive) return []
    compare(normalizedProject, normalizedLive, '', 0)
    return differences
  } catch {
    return []
  }
}

const schemaMapKeywords = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'])
const schemaArrayKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const schemaSingleKeywords = new Set(['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'not', 'if', 'then', 'else', 'contains', 'unevaluatedItems', 'contentSchema'])

function normalizeSchemaReferences(root: Record<string, unknown>, value: unknown, depth = 0, seenReferences = new Set<string>()): Record<string, unknown> | null {
  if (depth > 64) return null
  const source = objectValue(value)
  if (!source) return null
  let resolved: Record<string, unknown> = {}
  let childReferences = seenReferences
  if (Object.hasOwn(source, '$ref')) {
    const reference = source.$ref
    if (typeof reference !== 'string' || seenReferences.has(reference)) return null
    const target = schemaReferenceTarget(root, reference)
    if (!target) return null
    childReferences = new Set(seenReferences)
    childReferences.add(reference)
    const normalizedTarget = normalizeSchemaReferences(root, target, depth + 1, childReferences)
    if (!normalizedTarget) return null
    resolved = { ...normalizedTarget }
  }
  // Match the host's validated schema projection: JSON Schema siblings of
  // `$ref` replace annotations/keywords from the target in document order.
  for (const [key, child] of Object.entries(source)) {
    if (key !== '$ref') resolved[key] = child
  }
  const normalized: Record<string, unknown> = { ...resolved }
  for (const keyword of schemaMapKeywords) {
    const entries = objectValue(resolved[keyword])
    if (!entries) continue
    const mapped: Record<string, unknown> = {}
    for (const [name, child] of Object.entries(entries)) {
      if (typeof child === 'boolean') mapped[name] = child
      else {
        const normalizedChild = normalizeSchemaReferences(root, child, depth + 1, childReferences)
        if (!normalizedChild) return null
        mapped[name] = normalizedChild
      }
    }
    normalized[keyword] = mapped
  }
  for (const keyword of schemaArrayKeywords) {
    const entries = resolved[keyword]
    if (!Array.isArray(entries)) continue
    const mapped: unknown[] = []
    for (const child of entries) {
      if (typeof child === 'boolean') mapped.push(child)
      else {
        const normalizedChild = normalizeSchemaReferences(root, child, depth + 1, childReferences)
        if (!normalizedChild) return null
        mapped.push(normalizedChild)
      }
    }
    normalized[keyword] = mapped
  }
  for (const keyword of schemaSingleKeywords) {
    const child = resolved[keyword]
    if (child === undefined) continue
    if (typeof child === 'boolean') continue
    if (Array.isArray(child)) {
      const mapped: unknown[] = []
      for (const entry of child) {
        if (typeof entry === 'boolean') mapped.push(entry)
        else {
          const normalizedChild = normalizeSchemaReferences(root, entry, depth + 1, childReferences)
          if (!normalizedChild) return null
          mapped.push(normalizedChild)
        }
      }
      normalized[keyword] = mapped
      continue
    }
    const normalizedChild = normalizeSchemaReferences(root, child, depth + 1, childReferences)
    if (!normalizedChild) return null
    normalized[keyword] = normalizedChild
  }
  return normalized
}

function schemaReferenceTarget(root: Record<string, unknown>, reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined
  let pointer: string
  try {
    pointer = decodeURIComponent(reference.slice(1))
  } catch {
    return undefined
  }
  if (!pointer.startsWith('/')) return undefined
  let current: unknown = root
  for (const rawSegment of pointer.slice(1).split('/')) {
    if (/~(?![01])/u.test(rawSegment)) return undefined
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (['__proto__', 'prototype', 'constructor'].includes(segment)) return undefined
    const object = objectValue(current)
    if (!object || !Object.hasOwn(object, segment)) return undefined
    current = object[segment]
  }
  return current
}

/**
 * Extracts the SDK-owned, declarative UI hint from the Core-backed live
 * manifest. The JSON Schema remains authoritative; invalid or incompatible
 * hints are ignored and the caller falls back to the generic schema renderer.
 */
export function parseServiceConfigurationUI(manifestJSON: string, schema: Record<string, unknown>): ServiceConfigurationUI | null {
  if (manifestJSON.length > maxManifestBytes) return null
  try {
    const manifest = objectValue(JSON.parse(manifestJSON) as unknown)
    const source = objectValue(manifest?.configurationUI)
    if (!source || source.version !== 'service-configuration-ui/v1' || !Array.isArray(source.groups) || source.groups.length === 0 || source.groups.length > maxGroups) return null
    const resources: ServiceConfigurationResource[] = []
    const resourceById = new Map<string, ServiceConfigurationResource>()
    if (manifest?.resources !== undefined && !Array.isArray(manifest.resources)) return null
    const rawResources = Array.isArray(manifest?.resources) ? manifest.resources : []
    if (rawResources.length > 256) return null
    for (const rawResource of rawResources) {
      const resource = objectValue(rawResource)
      if (!resource || typeof resource.id !== 'string' || !identifier.test(resource.id) || resourceById.has(resource.id) ||
          typeof resource.kind !== 'string' || !resourceKinds.has(resource.kind) ||
          (resource.provider !== 'project' && resource.provider !== 'service-admin')) return null
      const parsed: ServiceConfigurationResource = {
        id: resource.id,
        kind: resource.kind as ServiceConfigurationResource['kind'],
        provider: resource.provider,
      }
      if (resource.provider === 'project') {
        if (resource.pageId !== undefined || resource.queryResource !== undefined || resource.valuePointer !== undefined || resource.labelPointer !== undefined) return null
      } else {
        if (typeof resource.pageId !== 'string' || !identifier.test(resource.pageId) ||
            typeof resource.queryResource !== 'string' || !identifier.test(resource.queryResource) ||
            typeof resource.valuePointer !== 'string' || !safeResourcePointer(resource.valuePointer) ||
            typeof resource.labelPointer !== 'string' || !safeResourcePointer(resource.labelPointer)) return null
        parsed.pageId = resource.pageId
        parsed.queryResource = resource.queryResource
        parsed.valuePointer = resource.valuePointer
        parsed.labelPointer = resource.labelPointer
      }
      resources.push(parsed)
      resourceById.set(parsed.id, parsed)
    }
    const peerContracts = new Set<string>()
    const secretPurposes = new Set<string>()
    if (manifest?.secretPurposes !== undefined) {
      if (!Array.isArray(manifest.secretPurposes) || manifest.secretPurposes.length > 128 || manifest.secretPurposes.some((purpose) => typeof purpose !== 'string' || purpose.length > 192 || !secretPurposePattern.test(purpose))) return null
      for (const purpose of manifest.secretPurposes) secretPurposes.add(purpose as string)
    }
    if (Array.isArray(manifest?.peerContracts)) {
      for (const value of manifest.peerContracts) {
        const contract = objectValue(value)
        if (typeof contract?.id === 'string') peerContracts.add(contract.id)
      }
    }
    const groupIDs = new Set<string>()
    const paths = new Set<string>()
    let fieldCount = 0
    const groups: ServiceConfigurationUIGroup[] = []
    for (const rawGroup of source.groups) {
      const group = objectValue(rawGroup)
      if (!group || typeof group.id !== 'string' || !identifier.test(group.id) || groupIDs.has(group.id) || !localized(group.title) || !Array.isArray(group.fields) || group.fields.length === 0) return null
      groupIDs.add(group.id)
      const groupOrder = orderValue(group.order)
      if (groupOrder === null) return null
      const fields: ServiceConfigurationUIField[] = []
      for (const rawField of group.fields) {
        fieldCount++
        const field = objectValue(rawField)
        if (fieldCount > maxFields || !field || typeof field.path !== 'string' || !localized(field.label) || typeof field.widget !== 'string' || !widgets.has(field.widget as ServiceConfigurationUIField['widget'])) return null
        const fieldOrder = orderValue(field.order)
        if (fieldOrder === null) return null
        const segments = pointerSegments(field.path)
        if (!segments || paths.has(field.path)) return null
        paths.add(field.path)
        const resolved = schemaAtPointer(schema, segments)
        const view = resolved ? effectiveConfigurationSchema(schema, resolved, {}) : null
        const secretPurpose = field.secretPurpose
        const isSecretReference = field.widget === 'secret'
        if (isSecretReference) {
          if (typeof secretPurpose !== 'string' || !secretPurposePattern.test(secretPurpose) || !secretPurposes.has(secretPurpose) ||
              !resolved || resolved.type !== 'string' || resolved.pattern !== '^ssr:v1:[a-f0-9]{32}$' || !isSensitiveConfigurationFieldName(segments.at(-1) ?? '')) return null
        } else if (secretPurpose !== undefined || !resolved || sensitiveSchemaNode(resolved, segments.at(-1)) || !widgetMatches(field.widget, view ?? resolved)) return null
        const help = field.help === undefined ? undefined : localized(field.help)
        const unit = field.unit === undefined ? undefined : localized(field.unit)
        if ((field.help !== undefined && !help) || (field.unit !== undefined && !unit)) return null
        const resourceKind = field.resourceKind
        const resourceId = field.resourceId
        const peerContractId = field.peerContractId
        if (field.widget === 'resource') {
          const resource = typeof resourceId === 'string' ? resourceById.get(resourceId) : undefined
          if (typeof resourceKind !== 'string' || !resourceKinds.has(resourceKind) || !resource || resource.kind !== resourceKind || peerContractId !== undefined) return null
        } else if (field.widget === 'peer') {
          if (typeof peerContractId !== 'string' || !identifier.test(peerContractId) || !peerContracts.has(peerContractId) || resourceKind !== undefined || resourceId !== undefined) return null
        } else if (field.widget === 'secret') {
          if (resourceKind !== undefined || resourceId !== undefined || peerContractId !== undefined) return null
        } else if (resourceKind !== undefined || resourceId !== undefined || peerContractId !== undefined) return null
        fields.push({
          path: field.path,
          segments,
          label: localized(field.label) as LocalizedConfigurationText,
          ...(help ? { help } : {}),
          ...(unit ? { unit } : {}),
          widget: field.widget as ServiceConfigurationUIField['widget'],
          ...(isSecretReference && typeof secretPurpose === 'string' ? { secretPurpose } : {}),
          ...(resourceKind ? { resourceKind } : {}),
          ...(typeof resourceId === 'string' ? { resourceId } : {}),
          ...(peerContractId ? { peerContractId } : {}),
          order: fieldOrder,
        })
      }
      const description = group.description === undefined ? undefined : localized(group.description)
      if (group.description !== undefined && !description) return null
      groups.push({
        id: group.id,
        title: localized(group.title) as LocalizedConfigurationText,
        ...(description ? { description } : {}),
        order: groupOrder,
        fields,
      })
    }
    groups.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    for (const group of groups) group.fields.sort((left, right) => left.order - right.order || left.path.localeCompare(right.path))
    return { version: 'service-configuration-ui/v1', groups, resources }
  } catch {
    return null
  }
}

function safeResourcePointer(pointer: string): boolean {
  const segments = pointerSegments(pointer)
  if (!segments || segments.some((segment) => segment === '*' || isSensitiveConfigurationFieldName(segment))) return false
  return true
}

export function pointerSegments(pointer: string): string[] | null {
  if (!pointer.startsWith('/') || pointer.length > 1024 || pointer.includes('\0')) return null
  const segments = pointer.slice(1).split('/')
  const decoded: string[] = []
  for (const segment of segments) {
    if (!segment || /~(?![01])/u.test(segment)) return null
    decoded.push(segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  }
  return decoded
}

export function schemaAtPointer(root: Record<string, unknown>, segments: string[]): Record<string, unknown> | null {
  let current = resolveConfigurationSchema(root, root)
  if (!current) return null
  for (const segment of segments) {
    if (segment === '*') {
      const item = configurationSchemaArrayItem(root, current)
      if (!item) return null
      current = item
      continue
    }
    const next = configurationSchemaChild(root, current, segment)
    if (!next) return null
    current = next
  }
  return current
}

export function configurationUIFieldKey(segments: string[]): string {
  return `/${segments.map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

/** Resolves an SDK field hint against a concrete path, including array `*` segments. */
export function matchServiceConfigurationUIField(configurationUI: ServiceConfigurationUI | null | undefined, segments: string[]): ServiceConfigurationUIField | null {
  if (!configurationUI || segments.length === 0) return null
  let exact: ServiceConfigurationUIField | null = null
  let best: ServiceConfigurationUIField | null = null
  let bestSpecificity = -1
  let ambiguous = false
  for (const group of configurationUI.groups) {
    for (const field of group.fields) {
      if (field.segments.length !== segments.length || !field.segments.every((part, index) => part === '*' || part === segments[index])) continue
      if (field.segments.every((part, index) => part === segments[index])) {
        exact = field
        continue
      }
      const specificity = field.segments.reduce((count, part) => count + (part === '*' ? 0 : 1), 0)
      if (specificity > bestSpecificity) {
        best = field
        bestSpecificity = specificity
        ambiguous = false
      } else if (specificity === bestSpecificity) {
        ambiguous = true
      }
    }
  }
  return exact ?? (ambiguous ? null : best)
}

function localized(value: unknown): LocalizedConfigurationText | null {
  const object = objectValue(value)
  if (!object || typeof object.ru !== 'string' || typeof object.en !== 'string') return null
  if (!validText(object.ru) || !validText(object.en)) return null
  return { ru: object.ru, en: object.en }
}

function validText(value: string): boolean {
  if (!value.trim() || value.length > 2048 || /[\0\r\n]/u.test(value)) return false
  const lower = value.toLowerCase()
  return !['password=', 'password:', 'secret=', 'secret:', 'token=', 'token:', 'private_key=', 'private-key=', 'bearer '].some((marker) => lower.includes(marker))
}

function orderValue(value: unknown): number | null {
  if (value === undefined) return 0
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null
}

function sensitiveSchemaNode(schema: Record<string, unknown>, propertyName?: string): boolean {
  return configurationSchemaProtected(schema, schema, propertyName) || schema.readOnly === true || schema.writeOnly === true || schema['x-liapoldus-sensitive'] === true || schema['x-sensitive'] === true || schema['x-secret'] === true || schema['x-redacted'] === true || schema.format === 'password' || isSensitiveConfigurationFieldName(propertyName)
}

function widgetMatches(widget: string, schema: Record<string, unknown>): boolean {
  if (widget === 'auto') return true
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const branches: unknown[] = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : []
    return branches.length > 0 && branches.every((branch) => objectValue(branch) !== null && widgetMatches(widget, objectValue(branch) as Record<string, unknown>))
  }
  if (Array.isArray(schema.allOf)) {
    const effective = effectiveConfigurationSchema(schema, schema, {})
    return effective ? widgetMatches(widget, effective) : false
  }
  if (Object.hasOwn(schema, 'const')) return widget === 'select'
  const declaredType: unknown = schema.type
  let type = ''
  if (typeof declaredType === 'string') type = declaredType
  else if (Array.isArray(declaredType) && declaredType.length === 1) {
    const onlyType: unknown = declaredType[0]
    if (typeof onlyType === 'string') type = onlyType
  }
  switch (widget) {
    case 'text': case 'textarea': return type === 'string'
    case 'number': return type === 'number' || type === 'integer'
    case 'slider': return (type === 'number' || type === 'integer') && typeof schema.minimum === 'number' && typeof schema.maximum === 'number'
    case 'toggle': return type === 'boolean'
    case 'select': return Array.isArray(schema.enum) || 'const' in schema
    case 'array': return type === 'array'
    case 'resource': return type === 'string'
    // Peer fields store one compatible Project service ID. Object bindings
    // require an explicit value-mapping contract instead of guessed keys.
    case 'peer': return type === 'string'
    default: return false
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left === right
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]))
  }
  const leftObject = objectValue(left)
  const rightObject = objectValue(right)
  if (!leftObject || !rightObject) return false
  const leftKeys = Object.keys(leftObject).sort()
  const rightKeys = Object.keys(rightObject).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && jsonEqual(leftObject[key], rightObject[key]))
}

function safeSchemaNumbers(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every((entry) => safeSchemaNumbers(entry, depth + 1))
  const object = objectValue(value)
  return Boolean(object && Object.values(object).every((entry) => safeSchemaNumbers(entry, depth + 1)))
}
