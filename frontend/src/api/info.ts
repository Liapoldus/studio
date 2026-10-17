import type {
  Diagnostic as DiagnosticData,
  InstalledStudioPluginState as InstalledStudioPluginStateData,
  ProjectFile as ProjectFileData,
  ProjectSettingsRecoveryCopy as ProjectSettingsRecoveryCopyData,
  Project as ProjectData,
  ServiceGraph as ServiceGraphData,
  ServiceLink as ServiceLinkData,
  ServiceSettingsSchemaPreview as ServiceSettingsSchemaPreviewData,
  ServiceArtifactReference as ServiceArtifactReferenceData,
  ProductInfo as ProductInfoData,
  RuntimeService as RuntimeServiceData,
  ToolchainStatus as ToolchainStatusData,
  TrafficRecordView as TrafficRecordViewData,
  Workspace as WorkspaceData,
  WorkspaceState as WorkspaceStateData,
  ArtifactReference as ArtifactReferenceData,
} from './types'

export type { ReportSummary } from './types'

// Wails generates unchecked constructors. This Studio-owned boundary keeps its
// exported models.ProductInfo factory while validating incoming values.
export class ProductInfo implements ProductInfoData {
  name: string
  description: string
  workspaceFeatures: string[]

  static createFrom(source: unknown = {}): ProductInfo {
    return new ProductInfo(source)
  }

  constructor(source: unknown = {}) {
    const value: unknown = typeof source === 'string' ? JSON.parse(source) : source
    if (typeof value !== 'object' || value === null ||
      !('name' in value) || typeof value.name !== 'string' ||
      !('description' in value) || typeof value.description !== 'string' ||
      !('workspaceFeatures' in value) || !Array.isArray(value.workspaceFeatures) ||
      !value.workspaceFeatures.every((feature: unknown) => typeof feature === 'string')) {
      throw new Error('Invalid Studio product information')
    }
    this.name = value.name
    this.description = value.description
    this.workspaceFeatures = [...value.workspaceFeatures]
  }
}

export class ArtifactReference implements ArtifactReferenceData {
  id: string
  version: string
  platform: string
  digest: string
  trusted: boolean
  command?: string
  manifest?: string
  schema?: string

  constructor(source: unknown = {}) {
    const value = object(source, 'artifact reference')
    this.id = stringField(value, 'id', 'artifact reference')
    this.version = stringField(value, 'version', 'artifact reference')
    this.platform = stringField(value, 'platform', 'artifact reference')
    this.digest = stringField(value, 'digest', 'artifact reference')
    this.trusted = booleanField(value, 'trusted', 'artifact reference')
    this.command = optionalStringField(value, 'command')
    this.manifest = optionalStringField(value, 'manifest')
    this.schema = optionalStringField(value, 'schema')
  }
}

export class ToolchainStatus implements ToolchainStatusData {
  cliAvailable: boolean
  cliPath: string
  cliVersion: string
  errorCode: string

  constructor(source: unknown = {}) {
    const value = object(source, 'toolchain status')
    this.cliAvailable = booleanField(value, 'cliAvailable', 'toolchain status')
    this.cliPath = stringField(value, 'cliPath', 'toolchain status')
    this.cliVersion = stringField(value, 'cliVersion', 'toolchain status')
    this.errorCode = stringField(value, 'errorCode', 'toolchain status')
  }
}

export class Diagnostic implements DiagnosticData {
  schemaVersion: string
  timestamp: string
  owner: string
  code: string
  severity: string
  message: string
  operationId: string
  target: string

  constructor(source: unknown = {}) {
    const value = object(source, 'diagnostic')
    this.schemaVersion = stringField(value, 'schemaVersion', 'diagnostic')
    this.timestamp = stringField(value, 'timestamp', 'diagnostic')
    this.owner = stringField(value, 'owner', 'diagnostic')
    this.code = stringField(value, 'code', 'diagnostic')
    this.severity = stringField(value, 'severity', 'diagnostic')
    this.message = stringField(value, 'message', 'diagnostic')
    this.operationId = stringField(value, 'operationId', 'diagnostic')
    this.target = stringField(value, 'target', 'diagnostic')
  }
}

export class Project implements ProjectData {
  id: string
  name: string
  rootPath: string

  constructor(source: unknown = {}) {
    const value = object(source, 'project')
    this.id = stringField(value, 'id', 'project')
    this.name = stringField(value, 'name', 'project')
    this.rootPath = stringField(value, 'rootPath', 'project')
  }
}

export class ProjectFile implements ProjectFileData {
  path: string
  kind: string
  bytes: number

  constructor(source: unknown = {}) {
    const value = object(source, 'project file')
    this.path = stringField(value, 'path', 'project file')
    this.kind = stringField(value, 'kind', 'project file')
    this.bytes = numberField(value, 'bytes', 'project file')
  }
}

export class ProjectSettingsRecoveryCopy implements ProjectSettingsRecoveryCopyData {
  path: string
  digest: string

  constructor(source: unknown = {}) {
    const value = object(source, 'project settings recovery copy')
    this.path = stringField(value, 'path', 'project settings recovery copy')
    this.digest = stringField(value, 'digest', 'project settings recovery copy')
    if (this.path.length > 512 || this.path.startsWith('/') || this.path.includes('\\') || /[\0\r\n]/u.test(this.path) ||
        !this.path.endsWith('.bak') || this.path.split('/').some((part) => !part || part === '.' || part === '..') ||
        !/^sha256:[a-f0-9]{64}$/u.test(this.digest)) throw new Error('Invalid Project settings recovery copy')
  }
}

export class InstalledStudioPluginState implements InstalledStudioPluginStateData {
  id: string
  version: string
  digest: string
  path: string
  enabled: boolean
  signed: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'installed Studio plugin')
    this.id = stringField(value, 'ID', 'installed Studio plugin')
    this.version = stringField(value, 'Version', 'installed Studio plugin')
    this.digest = stringField(value, 'Digest', 'installed Studio plugin')
    this.path = stringField(value, 'Path', 'installed Studio plugin')
    this.enabled = booleanField(value, 'Enabled', 'installed Studio plugin')
    this.signed = booleanField(value, 'Signed', 'installed Studio plugin')
  }
}

export class RuntimeService implements RuntimeServiceData {
  id: string
  name: string
  version: string
  manifestVersion: string
  servicePath: string
  settingsPath: string
  settingsSchemaPath: string
  configured: boolean
  problemCount: number
  linkPaths: string[]
  artifact?: ServiceArtifactReference

  constructor(source: unknown = {}) {
    const value = object(source, 'runtime service')
    this.id = stringField(value, 'id', 'runtime service')
    this.name = stringField(value, 'name', 'runtime service')
    this.version = stringField(value, 'version', 'runtime service')
    this.manifestVersion = stringField(value, 'manifestVersion', 'runtime service')
    this.servicePath = stringField(value, 'servicePath', 'runtime service')
    this.settingsPath = stringField(value, 'settingsPath', 'runtime service')
    this.settingsSchemaPath = stringField(value, 'settingsSchemaPath', 'runtime service')
    this.configured = booleanField(value, 'configured', 'runtime service')
    this.problemCount = numberField(value, 'problemCount', 'runtime service')
    this.linkPaths = stringArrayField(value, 'linkPaths', 'runtime service')
    if ('artifact' in value && value.artifact !== undefined && value.artifact !== null) this.artifact = new ServiceArtifactReference(value.artifact)
  }
}

export class ServiceArtifactReference implements ServiceArtifactReferenceData {
  id: string
  version: string
  platform: string
  digest: string

  constructor(source: unknown = {}) {
    const value = object(source, 'service artifact reference')
    this.id = stringField(value, 'id', 'service artifact reference')
    this.version = stringField(value, 'version', 'service artifact reference')
    this.platform = stringField(value, 'platform', 'service artifact reference')
    this.digest = stringField(value, 'digest', 'service artifact reference')
  }
}

export class ServiceLink implements ServiceLinkData {
  id: string
  caller: string
  target: string
  contractVersion: string
  methods: string[]
  transport: string
  sourcePath: string
  valid: boolean
  requestSchemaPath: string
  contractSchemaPath: string
  responseSchemaPath: string
  securityProfile: string
  timeoutMillis: number
  retryLimit: number
  requestLimitBytes: number
  responseLimitBytes: number
  disabledMethods: string[]
  compatibility: string
  redactionPolicy: string

  constructor(source: unknown = {}) {
    const value = object(source, 'service link')
    this.id = stringField(value, 'id', 'service link')
    this.caller = stringField(value, 'caller', 'service link')
    this.target = stringField(value, 'target', 'service link')
    this.contractVersion = stringField(value, 'contractVersion', 'service link')
    this.methods = stringArrayField(value, 'methods', 'service link')
    this.transport = stringField(value, 'transport', 'service link')
    this.sourcePath = stringField(value, 'sourcePath', 'service link')
    this.requestSchemaPath = stringField(value, 'requestSchemaPath', 'service link')
    this.contractSchemaPath = stringField(value, 'contractSchemaPath', 'service link')
    this.responseSchemaPath = stringField(value, 'responseSchemaPath', 'service link')
    this.securityProfile = stringField(value, 'securityProfile', 'service link')
    this.timeoutMillis = numberField(value, 'timeoutMillis', 'service link')
    this.retryLimit = numberField(value, 'retryLimit', 'service link')
    this.requestLimitBytes = numberField(value, 'requestLimitBytes', 'service link')
    this.responseLimitBytes = numberField(value, 'responseLimitBytes', 'service link')
    this.disabledMethods = stringArrayField(value, 'disabledMethods', 'service link')
    this.compatibility = stringField(value, 'compatibility', 'service link')
    this.redactionPolicy = stringField(value, 'redactionPolicy', 'service link')
    this.valid = booleanField(value, 'valid', 'service link')
  }
}

export class ServiceGraph implements ServiceGraphData {
  services: RuntimeService[]
  links: ServiceLink[]

  constructor(source: unknown = {}) {
    const value = object(source, 'service graph')
    this.services = arrayField(value, 'services', RuntimeService, 'service graph')
    this.links = arrayField(value, 'links', ServiceLink, 'service graph')
  }
}

export class Workspace implements WorkspaceData {
  project: Project | null
  files: ProjectFile[]

  constructor(source: unknown = {}) {
    const value = object(source, 'workspace')
    this.project = value.project === null || value.project === undefined ? null : new Project(value.project)
    this.files = arrayField(value, 'files', ProjectFile, 'workspace')
    this.graph = new ServiceGraph(value.graph)
  }

  graph: ServiceGraph
}

export class ServiceLinkInput {
  id = ''
  caller = ''
  target = ''
  contractVersion = ''
  methods: string[] = []
  transport = ''
  requestSchemaPath = ''
  responseSchemaPath = ''
  contractSchemaPath = ''
  securityProfile = ''
  timeoutMillis = 0
  retryLimit = 0
  requestLimitBytes = 0
  responseLimitBytes = 0
  disabledMethods: string[] = []
  compatibility = ''
  redactionPolicy = ''

  constructor(source: Partial<ServiceLinkInput> = {}) { Object.assign(this, source) }
}

export class ServiceSettingsSchemaPreview implements ServiceSettingsSchemaPreviewData {
  migrationChangedPaths: string[]
  schemaJson: string
  schemaDigest: string
  previousSchemaDigest: string
  settingsDigest: string
  draftDigest: string
  migrationCandidateDigest: string
  recoveryCopyPath: string
  recoverySchemaCopyPath: string
  migrationFromVersion: number
  migrationToVersion: number
  migrationRequired: boolean
  valuesCompatible: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'service settings schema preview')
    this.migrationChangedPaths = stringArrayField(value, 'migrationChangedPaths', 'service settings schema preview')
    this.schemaJson = stringField(value, 'schemaJson', 'service settings schema preview')
    this.schemaDigest = stringField(value, 'schemaDigest', 'service settings schema preview')
    this.previousSchemaDigest = stringField(value, 'previousSchemaDigest', 'service settings schema preview')
    this.settingsDigest = stringField(value, 'settingsDigest', 'service settings schema preview')
    this.draftDigest = stringField(value, 'draftDigest', 'service settings schema preview')
    this.migrationCandidateDigest = stringField(value, 'migrationCandidateDigest', 'service settings schema preview')
    this.recoveryCopyPath = stringField(value, 'recoveryCopyPath', 'service settings schema preview')
    this.recoverySchemaCopyPath = stringField(value, 'recoverySchemaCopyPath', 'service settings schema preview')
    this.migrationFromVersion = numberField(value, 'migrationFromVersion', 'service settings schema preview')
    this.migrationToVersion = numberField(value, 'migrationToVersion', 'service settings schema preview')
    this.migrationRequired = booleanField(value, 'migrationRequired', 'service settings schema preview')
    this.valuesCompatible = booleanField(value, 'valuesCompatible', 'service settings schema preview')
    if (this.schemaJson.length > 1_048_576 ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.schemaDigest) ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.previousSchemaDigest) ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.settingsDigest) ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.draftDigest) ||
      this.migrationChangedPaths.length > 16 || this.migrationChangedPaths.some((path) => !/^\/(?:[A-Za-z0-9_.~-]+\/?)*$/u.test(path)) ||
      (this.migrationRequired && (!Number.isSafeInteger(this.migrationFromVersion) || !Number.isSafeInteger(this.migrationToVersion) || this.migrationFromVersion <= 0 || this.migrationToVersion <= 0 || this.migrationFromVersion === this.migrationToVersion || !/^sha256:[a-f0-9]{64}$/u.test(this.migrationCandidateDigest) || this.migrationChangedPaths.length === 0 || this.recoveryCopyPath.startsWith('/') || !this.recoveryCopyPath.endsWith('.bak') || this.recoveryCopyPath.split('/').includes('..') || this.recoverySchemaCopyPath.startsWith('/') || !this.recoverySchemaCopyPath.endsWith('.bak') || this.recoverySchemaCopyPath.split('/').includes('..'))) ||
      (!this.migrationRequired && (this.migrationFromVersion !== 0 || this.migrationToVersion !== 0 || this.migrationCandidateDigest !== '' || this.migrationChangedPaths.length !== 0 || this.recoveryCopyPath !== '' || this.recoverySchemaCopyPath !== ''))) {
      throw new Error('Invalid Studio service settings schema preview')
    }
  }
}

export class RuntimeServiceInput {
  id = ''
  name = ''
  version = ''
  manifestVersion = ''
  settingsSchemaPath = ''

  constructor(source: Partial<RuntimeServiceInput> = {}) { Object.assign(this, source) }
}

export class TrafficRecordView implements TrafficRecordViewData {
  reportOperationId: string
  reportTarget: string
  reportCommitSha: string
  timestamp: string
  correlationId: string
  caller: string
  target: string
  method: string
  transport: string
  status: string
  schemaValidation: string
  requestPayload: string
  responsePayload: string
  latencyMillis: number
  requestSize: number
  responseSize: number

  constructor(source: unknown = {}) {
    const value = object(source, 'traffic record')
    this.reportOperationId = stringField(value, 'reportOperationId', 'traffic record')
    this.reportTarget = stringField(value, 'reportTarget', 'traffic record')
    this.reportCommitSha = stringField(value, 'reportCommitSha', 'traffic record')
    this.timestamp = stringField(value, 'timestamp', 'traffic record')
    this.correlationId = stringField(value, 'correlationId', 'traffic record')
    this.caller = stringField(value, 'caller', 'traffic record')
    this.target = stringField(value, 'target', 'traffic record')
    this.method = stringField(value, 'method', 'traffic record')
    this.transport = stringField(value, 'transport', 'traffic record')
    this.status = stringField(value, 'status', 'traffic record')
    this.schemaValidation = stringField(value, 'schemaValidation', 'traffic record')
    this.requestPayload = stringField(value, 'requestPayload', 'traffic record')
    this.responsePayload = stringField(value, 'responsePayload', 'traffic record')
    this.latencyMillis = numberField(value, 'latencyMillis', 'traffic record')
    this.requestSize = numberField(value, 'requestSize', 'traffic record')
    this.responseSize = numberField(value, 'responseSize', 'traffic record')
  }
}

function object(source: unknown, label: string): Record<string, unknown> {
  const value: unknown = typeof source === 'string' ? JSON.parse(source) : source
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Studio ${label}`)
  }
  return value as Record<string, unknown>
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
  if (typeof value[key] !== 'string') throw new Error(`Invalid Studio ${label}`)
  return value[key]
}

function optionalStringField(value: Record<string, unknown>, key: string): string | undefined {
  return value[key] === undefined ? undefined : typeof value[key] === 'string' ? value[key] : undefined
}

function stringArrayField(value: Record<string, unknown>, key: string, label: string): string[] {
  if (!Array.isArray(value[key]) || !value[key].every((entry): entry is string => typeof entry === 'string')) throw new Error(`Invalid Studio ${label}`)
  return value[key]
}

function numberField(value: Record<string, unknown>, key: string, label: string): number {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
    throw new Error(`Invalid Studio ${label}`)
  }
  return value[key]
}

function booleanField(value: Record<string, unknown>, key: string, label: string): boolean {
  if (typeof value[key] !== 'boolean') throw new Error(`Invalid Studio ${label}`)
  return value[key]
}

function arrayField<T>(value: Record<string, unknown>, key: string, constructor: { new(source: unknown): T }, label: string): T[] {
  if (!Array.isArray(value[key])) throw new Error(`Invalid Studio ${label}`)
  return value[key].map((entry) => new constructor(entry))
}

export class WorkspaceState implements WorkspaceStateData {
  projectId: string
  layoutJson: string
  tabsJson: string
  filtersJson: string

  constructor(source: unknown = {}) {
    const value = object(source, 'workspace state')
    this.projectId = stringField(value, 'projectId', 'workspace state')
    this.layoutJson = stringField(value, 'layoutJson', 'workspace state')
    this.tabsJson = stringField(value, 'tabsJson', 'workspace state')
    this.filtersJson = stringField(value, 'filtersJson', 'workspace state')
  }
}


export const models = { ArtifactReference, ProductInfo, Project, ProjectFile, ProjectSettingsRecoveryCopy, ToolchainStatus, InstalledStudioPluginState, RuntimeService, ServiceLink, ServiceGraph, TrafficRecordView, Workspace, WorkspaceState }
