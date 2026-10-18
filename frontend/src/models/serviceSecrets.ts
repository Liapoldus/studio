export type ServiceSecretReference = {
  reference: string
  serviceId: string
  purpose: string
  label: string
  state: 'active' | 'revoked'
  createdAt: string
}

export type PendingServiceSecretRotation = {
  previousReference: string
  createdReference: string
  serviceId: string
  purpose: string
  state: 'staged'
}

export type ServiceSecretCatalog = {
  items: ServiceSecretReference[]
  pendingRotations: PendingServiceSecretRotation[]
  pendingRegistrations: PendingServiceSecretRegistration[]
}

export type PendingServiceSecretRegistration = {
  reference: string
  serviceId: string
  purpose: string
  label: string
  state: 'pending' | 'conflict'
}

export function serviceSecretReferencePaths(value: unknown, reference: string, path: string[] = []): string[][] {
  if (value === reference) return [path]
  if (Array.isArray(value)) return value.flatMap((child, index) => serviceSecretReferencePaths(child, reference, [...path, String(index)]))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => serviceSecretReferencePaths(child, reference, [...path, key]))
}

export function serviceSecretJSONPointer(path: string[]): string {
  return `/${path.map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const purposePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u

export function parseDeclaredSecretPurposes(raw: string, serviceID: string): string[] {
  if (raw.length > 1_048_576) throw new Error('Service manifest is too large')
  const manifest = objectValue(JSON.parse(raw) as unknown)
  if (!manifest || manifest.id !== serviceID) throw new Error('Service returned an invalid secret purpose catalog')
  const purposes = manifest.secretPurposes === undefined ? [] : manifest.secretPurposes
  if (!Array.isArray(purposes) || purposes.length > 128) throw new Error('Service returned an invalid secret purpose catalog')
  if (!purposes.every((purpose: unknown) => typeof purpose === 'string' && purpose.length <= 192 && purposePattern.test(purpose))) throw new Error('Service returned an invalid secret purpose catalog')
  return [...new Set(purposes as string[])].sort()
}

export function parseServiceSecretCatalog(raw: string, serviceID: string): ServiceSecretReference[] {
  return parseServiceSecretCatalogDetails(raw, serviceID).items
}

export function parseServiceSecretCatalogDetails(raw: string, serviceID: string): ServiceSecretCatalog {
  if (raw.length > 1_048_576) throw new Error('Secret catalog is too large')
  const catalog = objectValue(JSON.parse(raw) as unknown)
  if (catalog === null) throw new Error('Studio returned an invalid local secret catalog')
  if (!hasExactKeys(catalog, ['schemaVersion', 'target', 'serviceId', 'items', 'pendingRotations', 'pendingRegistrations']) ||
      catalog.schemaVersion !== 'service-secret-references/v1' || catalog.target !== 'local' || catalog.serviceId !== serviceID ||
      !Array.isArray(catalog.items) || catalog.items.length > 4096 || !Array.isArray(catalog.pendingRotations) || catalog.pendingRotations.length > 4096 ||
      !Array.isArray(catalog.pendingRegistrations) || catalog.pendingRegistrations.length > 4096) throw new Error('Studio returned an invalid local secret catalog')
  const items = catalog.items.map((candidate: unknown): ServiceSecretReference => {
    const item = objectValue(candidate)
    if (!item || !hasExactKeys(item, ['reference', 'serviceId', 'purpose', 'label', 'state', 'createdAt']) || item.serviceId !== serviceID || typeof item.reference !== 'string' || !/^ssr:v1:[a-f0-9]{32}$/u.test(item.reference) ||
        typeof item.purpose !== 'string' || !purposePattern.test(item.purpose) ||
        typeof item.label !== 'string' || item.label.length === 0 || item.label.length > 128 || /[\p{Cc}]/u.test(item.label) ||
        (item.state !== 'active' && item.state !== 'revoked') || typeof item.createdAt !== 'string' || item.createdAt.length > 64) throw new Error('Studio returned invalid secret metadata')
    return { reference: item.reference, serviceId: serviceID, purpose: item.purpose, label: item.label, state: item.state, createdAt: item.createdAt }
  })
  if (new Set(items.map((item) => item.reference)).size !== items.length) throw new Error('Studio returned duplicate secret references')
  const itemsByReference = new Map(items.map((item) => [item.reference, item]))
  const pendingRotations = catalog.pendingRotations.map((candidate: unknown): PendingServiceSecretRotation => {
    const rotation = objectValue(candidate)
    if (!rotation || !hasExactKeys(rotation, ['previousReference', 'createdReference', 'serviceId', 'purpose', 'state']) ||
        rotation.serviceId !== serviceID || typeof rotation.previousReference !== 'string' || !/^ssr:v1:[a-f0-9]{32}$/u.test(rotation.previousReference) ||
        typeof rotation.createdReference !== 'string' || !/^ssr:v1:[a-f0-9]{32}$/u.test(rotation.createdReference) || rotation.createdReference === rotation.previousReference ||
        typeof rotation.purpose !== 'string' || !purposePattern.test(rotation.purpose) || rotation.state !== 'staged') throw new Error('Studio returned invalid pending rotation metadata')
    const previous = itemsByReference.get(rotation.previousReference)
    const created = itemsByReference.get(rotation.createdReference)
    if (!previous || !created || previous.state !== 'active' || created.state !== 'active' || previous.purpose !== rotation.purpose || created.purpose !== rotation.purpose) {
      throw new Error('Pending rotation references do not match the active local catalog')
    }
    return { previousReference: rotation.previousReference, createdReference: rotation.createdReference, serviceId: serviceID, purpose: rotation.purpose, state: 'staged' }
  })
  if (new Set(pendingRotations.map((rotation) => rotation.createdReference)).size !== pendingRotations.length) throw new Error('Studio returned duplicate pending rotations')
  const pendingRegistrations = catalog.pendingRegistrations.map((candidate: unknown): PendingServiceSecretRegistration => {
    const registration = objectValue(candidate)
    if (!registration || !hasExactKeys(registration, ['reference', 'serviceId', 'purpose', 'label', 'state']) ||
        registration.serviceId !== serviceID || typeof registration.reference !== 'string' || !/^ssr:v1:[a-f0-9]{32}$/u.test(registration.reference) ||
        typeof registration.purpose !== 'string' || !purposePattern.test(registration.purpose) || typeof registration.label !== 'string' ||
        !registration.label || registration.label.length > 128 || /[\p{Cc}]/u.test(registration.label) ||
        (registration.state !== 'pending' && registration.state !== 'conflict')) throw new Error('Studio returned invalid pending registration metadata')
    return { reference: registration.reference, serviceId: serviceID, purpose: registration.purpose, label: registration.label, state: registration.state }
  })
  if (new Set(pendingRegistrations.map((registration) => registration.reference)).size !== pendingRegistrations.length) throw new Error('Studio returned duplicate pending registrations')
  return { items, pendingRotations, pendingRegistrations }
}

export function parseServiceSecretRotationResult(raw: string, serviceID: string, previousReference: string, purpose: string): ServiceSecretReference {
  if (raw.length > 64 * 1024) throw new Error('Secret rotation response is too large')
  const result = objectValue(JSON.parse(raw) as unknown)
  if (!result || !hasExactKeys(result, ['schemaVersion', 'target', 'serviceId', 'previous', 'created', 'state']) ||
      result.schemaVersion !== 'service-secret-rotation-result/v1' || result.target !== 'local' || result.serviceId !== serviceID || result.state !== 'staged') {
    throw new Error('Studio returned an invalid secret rotation result')
  }
  const previous = objectValue(result.previous)
  const created = objectValue(result.created)
  if (!previous || !hasExactKeys(previous, ['reference', 'serviceId', 'purpose', 'label', 'state', 'createdAt']) ||
      previous.reference !== previousReference || previous.serviceId !== serviceID || previous.purpose !== purpose || previous.state !== 'active' ||
      typeof previous.label !== 'string' || !previous.label || typeof previous.createdAt !== 'string' ||
      !created || !hasExactKeys(created, ['reference', 'serviceId', 'purpose', 'label', 'state', 'createdAt']) ||
      created.reference === previousReference || created.serviceId !== serviceID || created.purpose !== purpose || created.state !== 'active' ||
      typeof created.reference !== 'string' || !/^ssr:v1:[a-f0-9]{32}$/u.test(created.reference) ||
      typeof created.label !== 'string' || !created.label || created.label.length > 128 || /[\p{Cc}]/u.test(created.label) ||
      typeof created.createdAt !== 'string' || created.createdAt.length > 64) {
    throw new Error('Studio returned invalid secret rotation metadata')
  }
  return { reference: created.reference, serviceId: serviceID, purpose, label: created.label, state: 'active', createdAt: created.createdAt }
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
