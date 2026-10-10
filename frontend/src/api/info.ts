import type {
  GitChange as GitChangeData,
  GitBranch as GitBranchData,
  GitCommit as GitCommitData,
  GitDiff as GitDiffData,
  GitRemote as GitRemoteData,
  GitStatus as GitStatusData,
  Diagnostic as DiagnosticData,
  InstalledPluginState as InstalledPluginStateData,
  ProjectFile as ProjectFileData,
  Project as ProjectData,
  PluginGraph as PluginGraphData,
  PluginLink as PluginLinkData,
  ProductInfo as ProductInfoData,
  RuntimePlugin as RuntimePluginData,
  TrafficRecordView as TrafficRecordViewData,
  Workspace as WorkspaceData,
  WorkspaceState as WorkspaceStateData,
} from './types'

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
    this.changes = arrayField(value, 'changes', 'git status').map((change) => new GitChange(change))
    this.dirty = booleanField(value, 'dirty', 'git status')
    this.available = booleanField(value, 'available', 'git status')
    this.conflict = booleanField(value, 'conflict', 'git status')
  }
}

export class InstalledPluginState implements InstalledPluginStateData {
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

export class RuntimePlugin implements RuntimePluginData {
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

  constructor(source: unknown = {}) {
    const value = object(source, 'runtime plugin')
    this.id = stringField(value, 'id', 'runtime plugin')
    this.name = stringField(value, 'name', 'runtime plugin')
    this.version = stringField(value, 'version', 'runtime plugin')
    this.manifestVersion = stringField(value, 'manifestVersion', 'runtime plugin')
    this.servicePath = stringField(value, 'servicePath', 'runtime plugin')
    this.settingsPath = stringField(value, 'settingsPath', 'runtime plugin')
    this.settingsSchemaPath = stringField(value, 'settingsSchemaPath', 'runtime plugin')
    this.configured = booleanField(value, 'configured', 'runtime plugin')
    this.problemCount = numberField(value, 'problemCount', 'runtime plugin')
    this.linkPaths = arrayField(value, 'linkPaths', 'runtime plugin').map((path) => {
      if (typeof path !== 'string') throw new Error('Invalid Studio runtime plugin')
      return path
    })
  }
}

export class PluginLink implements PluginLinkData {
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
    const value = object(source, 'plugin link')
    this.id = stringField(value, 'id', 'plugin link')
    this.caller = stringField(value, 'caller', 'plugin link')
    this.target = stringField(value, 'target', 'plugin link')
    this.contractVersion = stringField(value, 'contractVersion', 'plugin link')
    this.methods = arrayField(value, 'methods', 'plugin link').map((method) => {
      if (typeof method !== 'string') throw new Error('Invalid Studio plugin link')
      return method
    })
    this.transport = stringField(value, 'transport', 'plugin link')
    this.sourcePath = stringField(value, 'sourcePath', 'plugin link')
    this.requestSchemaPath = stringField(value, 'requestSchemaPath', 'plugin link')
    this.contractSchemaPath = stringField(value, 'contractSchemaPath', 'plugin link')
    this.responseSchemaPath = stringField(value, 'responseSchemaPath', 'plugin link')
    this.securityProfile = stringField(value, 'securityProfile', 'plugin link')
    this.timeoutMillis = numberField(value, 'timeoutMillis', 'plugin link')
    this.retryLimit = numberField(value, 'retryLimit', 'plugin link')
    this.requestLimitBytes = numberField(value, 'requestLimitBytes', 'plugin link')
    this.responseLimitBytes = numberField(value, 'responseLimitBytes', 'plugin link')
    this.disabledMethods = arrayField(value, 'disabledMethods', 'plugin link').map((method) => {
      if (typeof method !== 'string') throw new Error('Invalid Studio plugin link')
      return method
    })
    this.compatibility = stringField(value, 'compatibility', 'plugin link')
    this.redactionPolicy = stringField(value, 'redactionPolicy', 'plugin link')
    this.valid = booleanField(value, 'valid', 'plugin link')
  }
}

export class PluginGraph implements PluginGraphData {
  plugins: RuntimePlugin[]
  links: PluginLink[]

  constructor(source: unknown = {}) {
    const value = object(source, 'plugin graph')
    this.plugins = arrayField(value, 'plugins', 'plugin graph').map((plugin) => new RuntimePlugin(plugin))
    this.links = arrayField(value, 'links', 'plugin graph').map((link) => new PluginLink(link))
  }
}

export class Workspace implements WorkspaceData {
  project: Project | null
  files: ProjectFile[]
  git: GitStatus

  constructor(source: unknown = {}) {
    const value = object(source, 'workspace')
    this.project = value.project === null || value.project === undefined ? null : new Project(value.project)
    this.files = arrayField(value, 'files', 'workspace').map((file) => new ProjectFile(file))
    this.git = new GitStatus(value.git)
    this.graph = new PluginGraph(value.graph)
  }

  graph: PluginGraph
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

function arrayField(value: Record<string, unknown>, key: string, label: string): unknown[] {
  if (!Array.isArray(value[key])) throw new Error(`Invalid Studio ${label}`)
  return value[key]
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

export const models = { ProductInfo, Project, ProjectFile, GitBranch, GitChange, GitDiff, GitStatus, InstalledPluginState, RuntimePlugin, PluginLink, PluginGraph, TrafficRecordView, Workspace, WorkspaceState }
