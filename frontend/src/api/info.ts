import type {
  GitChange as GitChangeData,
  GitBranch as GitBranchData,
  GitCommit as GitCommitData,
  GitConflict as GitConflictData,
  GitConflictSide as GitConflictSideData,
  GitDiff as GitDiffData,
  GitRemote as GitRemoteData,
  GitStash as GitStashData,
  GitStatus as GitStatusData,
  Diagnostic as DiagnosticData,
  InstalledStudioPluginState as InstalledStudioPluginStateData,
  ProjectFile as ProjectFileData,
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

export class GitChange implements GitChangeData {
  path: string
  indexStatus: string
  worktreeStatus: string

  constructor(source: unknown = {}) {
    const value = object(source, 'git change')
    this.path = stringField(value, 'path', 'git change')
    this.indexStatus = stringField(value, 'indexStatus', 'git change')
    this.worktreeStatus = stringField(value, 'worktreeStatus', 'git change')
  }
}

export class GitBranch implements GitBranchData {
  name: string
  remote: string
  current: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'git branch')
    this.name = stringField(value, 'name', 'git branch')
    this.remote = stringField(value, 'remote', 'git branch')
    this.current = booleanField(value, 'current', 'git branch')
  }
}

export class GitDiff implements GitDiffData {
  path: string
  patch: string
  truncated: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'git diff')
    this.path = stringField(value, 'path', 'git diff')
    this.patch = stringField(value, 'patch', 'git diff')
    this.truncated = booleanField(value, 'truncated', 'git diff')
  }
}

export class GitConflictSide implements GitConflictSideData {
  available: boolean
  content: string
  truncated: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'git conflict side')
    this.available = booleanField(value, 'available', 'git conflict side')
    this.content = stringField(value, 'content', 'git conflict side')
    this.truncated = booleanField(value, 'truncated', 'git conflict side')
  }
}

export class GitConflict implements GitConflictData {
  path: string
  base: GitConflictSide
  ours: GitConflictSide
  theirs: GitConflictSide

  constructor(source: unknown = {}) {
    const value = object(source, 'git conflict')
    this.path = stringField(value, 'path', 'git conflict')
    this.base = new GitConflictSide(value.base)
    this.ours = new GitConflictSide(value.ours)
    this.theirs = new GitConflictSide(value.theirs)
  }
}

export class GitCommit implements GitCommitData {
  hash: string
  shortHash: string
  author: string
  timestamp: string
  subject: string

  constructor(source: unknown = {}) {
    const value = object(source, 'git commit')
    this.hash = stringField(value, 'hash', 'git commit')
    this.shortHash = stringField(value, 'shortHash', 'git commit')
    this.author = stringField(value, 'author', 'git commit')
    this.timestamp = stringField(value, 'timestamp', 'git commit')
    this.subject = stringField(value, 'subject', 'git commit')
  }
}

export class GitRemote implements GitRemoteData {
  name: string
  fetchUrl: string
  pushUrl: string

  constructor(source: unknown = {}) {
    const value = object(source, 'git remote')
    this.name = stringField(value, 'name', 'git remote')
    this.fetchUrl = stringField(value, 'fetchUrl', 'git remote')
    this.pushUrl = stringField(value, 'pushUrl', 'git remote')
  }
}

export class GitStash implements GitStashData {
  ref: string
  message: string
  createdAt: string

  constructor(source: unknown = {}) {
    const value = object(source, 'git stash')
    this.ref = stringField(value, 'ref', 'git stash')
    this.message = stringField(value, 'message', 'git stash')
    this.createdAt = stringField(value, 'createdAt', 'git stash')
  }
}

export class GitStatus implements GitStatusData {
  branch: string
  revision: string
  changes: GitChange[]
  dirty: boolean
  available: boolean
  conflict: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'git status')
    this.branch = stringField(value, 'branch', 'git status')
    this.revision = stringField(value, 'revision', 'git status')
    this.changes = arrayField(value, 'changes', GitChange, 'git status')
    this.dirty = booleanField(value, 'dirty', 'git status')
    this.available = booleanField(value, 'available', 'git status')
    this.conflict = booleanField(value, 'conflict', 'git status')
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
  git: GitStatus

  constructor(source: unknown = {}) {
    const value = object(source, 'workspace')
    this.project = value.project === null || value.project === undefined ? null : new Project(value.project)
    this.files = arrayField(value, 'files', ProjectFile, 'workspace')
    this.git = new GitStatus(value.git)
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
  schemaJson: string
  schemaDigest: string
  settingsDigest: string
  draftDigest: string
  valuesCompatible: boolean

  constructor(source: unknown = {}) {
    const value = object(source, 'service settings schema preview')
    this.schemaJson = stringField(value, 'schemaJson', 'service settings schema preview')
    this.schemaDigest = stringField(value, 'schemaDigest', 'service settings schema preview')
    this.settingsDigest = stringField(value, 'settingsDigest', 'service settings schema preview')
    this.draftDigest = stringField(value, 'draftDigest', 'service settings schema preview')
    this.valuesCompatible = booleanField(value, 'valuesCompatible', 'service settings schema preview')
    if (this.schemaJson.length > 1_048_576 ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.schemaDigest) ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.settingsDigest) ||
      !/^sha256:[a-f0-9]{64}$/u.test(this.draftDigest)) {
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


export const models = { ArtifactReference, ProductInfo, Project, ProjectFile, ToolchainStatus, GitBranch, GitChange, GitDiff, GitConflictSide, GitConflict, GitStash, GitStatus, InstalledStudioPluginState, RuntimeService, ServiceLink, ServiceGraph, TrafficRecordView, Workspace, WorkspaceState }
