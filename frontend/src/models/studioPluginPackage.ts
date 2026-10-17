export type StudioPluginPackageSurface = {
  id: string
  kind: 'page' | 'panel' | 'command'
  context: 'workspace' | 'service'
  title: string
  route: string
}

export type StudioPluginPackageInfo = {
  id: string
  name: string
  version: string
  studioRange: string
  digest: string
  signed: boolean
  permissions: string[]
  grantedPermissions: string[]
  surfaces: StudioPluginPackageSurface[]
  toolIds: string[]
}

export type StudioPluginVersionGroup = {
  id: string
  name: string
  current: StudioPluginPackageInfo
  previous: StudioPluginPackageInfo[]
}

export function groupStudioPluginVersions(packages: StudioPluginPackageInfo[]): StudioPluginVersionGroup[] {
  const grouped = new Map<string, StudioPluginPackageInfo[]>()
  for (const plugin of packages) {
    const versions = grouped.get(plugin.id) ?? []
    if (!versions.some((item) => item.version === plugin.version)) versions.push(plugin)
    grouped.set(plugin.id, versions)
  }
  return [...grouped.entries()]
    .map(([id, versions]) => {
      const current = versions.reduce((latest, candidate) => compareStudioPluginVersions(candidate.version, latest.version) < 0 ? candidate : latest)
      const previous = versions.filter((candidate) => candidate !== current).sort((left, right) => compareStudioPluginVersions(left.version, right.version))
      return { id, name: current.name, current, previous }
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

export function latestStudioPluginSurfaces<T extends { studioPluginId: string; version: string }>(surfaces: readonly T[]): T[] {
  const latestByPlugin = new Map<string, string>()
  for (const surface of surfaces) {
    const current = latestByPlugin.get(surface.studioPluginId)
    if (current === undefined || compareStudioPluginVersions(surface.version, current) < 0) latestByPlugin.set(surface.studioPluginId, surface.version)
  }
  return surfaces.filter((surface) => latestByPlugin.get(surface.studioPluginId) === surface.version)
}

export function compareStudioPluginVersions(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return right.localeCompare(left, undefined, { numeric: true })
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return b.core[index] - a.core[index]
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return -1
  if (!b.prerelease) return 1
  return b.prerelease.localeCompare(a.prerelease, undefined, { numeric: true })
}

function parseSemver(value: string): { core: [number, number, number]; prerelease: string } | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return null
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (core.some((part) => !Number.isSafeInteger(part))) return null
  return { core, prerelease: match[4] || '' }
}

const digestPattern = /^sha256:[a-f0-9]{64}$/
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function parseStudioPluginInspection(source: string): StudioPluginPackageInfo {
  if (source.length > 2 * 1024 * 1024) throw new Error('Studio plugin inspection is too large')
  return parseInspection(JSON.parse(source) as unknown)
}

export function parseInstalledStudioPluginInspections(source: string): StudioPluginPackageInfo[] {
  if (source.length > 8 * 1024 * 1024) throw new Error('Installed Studio plugin list is too large')
  const value: unknown = JSON.parse(source)
  if (!Array.isArray(value) || value.length > 512) throw new Error('Invalid installed Studio plugin list')
  return value.map(parseInspection)
}

function parseInspection(source: unknown): StudioPluginPackageInfo {
  const inspection = record(source, 'inspection')
  const manifest = record(inspection.manifest, 'manifest')
  const id = requiredString(manifest.id, 'plugin id', 128)
  const name = requiredString(manifest.name, 'plugin name', 160)
  const version = requiredString(manifest.version, 'plugin version', 128)
  const studioRange = requiredString(manifest.studioRange, 'Studio compatibility range', 128)
  const digest = requiredString(inspection.digest, 'plugin digest', 71)
  if (!identifierPattern.test(id) || !digestPattern.test(digest)) throw new Error('Invalid Studio plugin identity or digest')
  if (typeof inspection.signed !== 'boolean') throw new Error('Invalid Studio plugin signature status')
  return {
    id,
    name,
    version,
    studioRange,
    digest,
    signed: inspection.signed,
    permissions: stringList(manifest.permissions, 'plugin permissions', 128),
    grantedPermissions: stringList(inspection.grantedPermissions ?? [], 'granted permissions', 128),
    surfaces: parseSurfaces(manifest.surfaces),
    toolIds: parseToolIds(manifest.tools),
  }
}

function parseSurfaces(source: unknown): StudioPluginPackageSurface[] {
  if (source === undefined) return []
  if (!Array.isArray(source) || source.length > 128) throw new Error('Invalid Studio plugin surfaces')
  return source.map((entry) => {
    const value = record(entry, 'surface')
    const id = requiredString(value.id, 'surface id', 128)
    const kind = requiredString(value.kind, 'surface kind', 16)
    // Older installed manifests are serialized by Go with an empty context.
    // Treat that shape like an omitted context so pre-context plugins remain usable.
    const context = value.context === undefined || value.context === '' ? 'workspace' : requiredString(value.context, 'surface context', 16)
    const title = requiredString(value.title, 'surface title', 160)
    const route = value.route === undefined ? '' : requiredString(value.route, 'surface route', 512)
    if (!identifierPattern.test(id) || (kind !== 'page' && kind !== 'panel' && kind !== 'command') || (context !== 'workspace' && context !== 'service')) throw new Error('Invalid Studio plugin surface')
    if (route && (route.startsWith('/') || route.includes('\\') || route.split('/').some((part) => !part || part === '.' || part === '..'))) throw new Error('Invalid Studio plugin surface route')
    return { id, kind, context, title, route }
  })
}

function parseToolIds(source: unknown): string[] {
  if (source === undefined) return []
  if (!Array.isArray(source) || source.length > 128) throw new Error('Invalid Studio plugin tools')
  return source.map((entry) => {
    const tool = record(entry, 'tool')
    const id = requiredString(tool.id, 'tool id', 128)
    if (!identifierPattern.test(id)) throw new Error('Invalid Studio plugin tool id')
    return id
  })
}

function stringList(source: unknown, label: string, limit: number): string[] {
  if (!Array.isArray(source) || source.length > limit) throw new Error(`Invalid ${label}`)
  const values = source.map((value) => requiredString(value, label, 160))
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`)
  return values
}

function record(source: unknown, label: string): Record<string, unknown> {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) throw new Error(`Invalid Studio plugin ${label}`)
  return source as Record<string, unknown>
}

function requiredString(source: unknown, label: string, maxLength: number): string {
  if (typeof source !== 'string' || source.trim() !== source || !source || source.length > maxLength) throw new Error(`Invalid Studio plugin ${label}`)
  return source
}
