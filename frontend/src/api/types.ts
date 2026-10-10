export interface ProductInfo {
  name: string
  description: string
  workspaceFeatures: string[]
}

export interface StudioAPI {
  productInfo(): Promise<ProductInfo>
  clientPreferences(): Promise<ClientPreferences>
  saveClientPreferences(theme: ThemePreference): Promise<void>
  listProjects(): Promise<Project[]>
  openProject(root: string): Promise<Workspace>
  workspace(): Promise<Workspace>
  readWorkspaceState(): Promise<WorkspaceState>
  writeWorkspaceState(state: WorkspaceState): Promise<void>
  openFileExternally(path: string, application: string): Promise<void>
  editorAssociations(): Promise<EditorAssociation[]>
  selectExternalEditor(): Promise<string>
  saveEditorAssociation(pattern: string, application: string): Promise<void>
  readProjectFile(path: string): Promise<Uint8Array>
  writeProjectFile(path: string, content: Uint8Array): Promise<void>
  readProjectSchema(schemaPath: string): Promise<Uint8Array>
  readProjectSettings(settingsPath: string, schemaPath: string): Promise<Uint8Array>
  writeProjectSettings(settingsPath: string, schemaPath: string, patch: Uint8Array): Promise<void>
  runCLI(args: string[]): Promise<void>
  cancelCLI(): Promise<void>
  prepareRemoteHandoff(target: string): Promise<string>
  onCLIEvent(callback: (event: CLIEvent) => void): () => void
  trafficRecords(): Promise<TrafficRecordView[]>
  exportTrafficReport(): Promise<string>
  selectStudioPluginPackage(): Promise<string>
  inspectStudioPlugin(packagePath: string): Promise<string>
  installStudioPlugin(packagePath: string, approved: boolean, reason: string, grantedPermissions: string[]): Promise<string>
  removeStudioPlugin(pluginId: string, version: string): Promise<void>
  diagnostics(): Promise<Diagnostic[]>
  installedStudioPlugins(): Promise<InstalledPluginState[]>
  installedStudioPluginManifests(): Promise<string>
  readStudioPluginSurface(pluginId: string, version: string, surfaceId: string): Promise<string>
  runStudioPluginTool(pluginId: string, version: string, toolId: string, args: string[]): Promise<string>
  startStudioPluginProcess(pluginId: string, version: string): Promise<string>
  stopStudioPluginProcess(pluginId: string, version: string): Promise<void>
  studioPluginProcessStatus(pluginId: string, version: string): Promise<string>
  gitDiff(path: string): Promise<GitDiff>
  gitBranches(): Promise<GitBranch[]>
  gitHistory(limit: number): Promise<GitCommit[]>
  gitRemotes(): Promise<GitRemote[]>
  gitCheckout(branch: string, confirmed: boolean): Promise<void>
  gitCommit(message: string, paths: string[], confirmed: boolean): Promise<string>
  gitPull(remote: string, branch: string, confirmed: boolean): Promise<void>
  gitPush(remote: string, branch: string, confirmed: boolean): Promise<void>
}

export type ThemePreference = 'system' | 'light' | 'dark'
export interface ClientPreferences { theme: ThemePreference }

export interface CLIEvent {
  schemaVersion: string
  type: string
  runId?: string
  severity?: string
  phase?: string
  code?: string
  message?: string
  operationId?: string
  target?: string
  state?: string
  kind?: string
  timestamp?: string
  payload?: unknown
  digest?: string
  percent?: number
  exitCode?: number
}

export interface Diagnostic {
  schemaVersion: string
  timestamp: string
  owner: string
  code: string
  severity: string
  message: string
  operationId?: string
  target?: string
}

export interface TrafficRecordView {
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
}

export interface InstalledPluginState {
  id: string
  version: string
  digest: string
  path: string
  enabled: boolean
  signed: boolean
}

export interface EditorAssociation {
  pattern: string
  application: string
}

export interface GitBranch {
  name: string
  remote: string
  current: boolean
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  timestamp: string
  subject: string
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface GitDiff {
  path: string
  patch: string
  truncated: boolean
}

export interface Project {
  id: string
  name: string
  rootPath: string
}

export interface ProjectFile {
  path: string
  kind: string
  bytes: number
}

export interface GitStatus {
  branch: string
  revision: string
  changes: GitChange[]
  dirty: boolean
  available: boolean
  conflict: boolean
}

export interface GitChange {
  path: string
  indexStatus: string
  worktreeStatus: string
}

export interface Workspace {
  project: Project | null
  files: ProjectFile[]
  git: GitStatus
  graph: PluginGraph
}

export interface WorkspaceState {
  projectId: string
  layoutJson: string
  tabsJson: string
  filtersJson: string
}

export interface RuntimePlugin {
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
}

export interface PluginLink {
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
}

export interface PluginGraph {
  plugins: RuntimePlugin[]
  links: PluginLink[]
}
