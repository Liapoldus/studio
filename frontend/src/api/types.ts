export interface ProductInfo {
  name: string
  description: string
  workspaceFeatures: string[]
}

export interface ToolchainStatus {
  cliAvailable: boolean
  cliPath: string
  cliVersion: string
  errorCode: string
}

export interface CoreBinaryInspection {
  digest: string
  platform: string
  sizeBytes: number
}

export interface CoreSettingsView {
  schemaVersion: 'core-settings-view/v1'
  target: 'local'
  desiredRevision: number
  effectiveRevision: number
  pending: boolean
  restartRequired: boolean
  settings: {
    management: {
      listen: string
      maxBodyBytes: number
      headerTimeout: string
      requestTimeout: string
    }
  }
}

export interface ServiceSettingsSchemaPreview {
  schemaJson: string
  schemaDigest: string
  previousSchemaDigest: string
  settingsDigest: string
  draftDigest: string
  migrationRequired: boolean
  migrationFromVersion: number
  migrationToVersion: number
  migrationCandidateDigest: string
  migrationChangedPaths: string[]
  recoveryCopyPath: string
  recoverySchemaCopyPath: string
  valuesCompatible: boolean
}

export interface StudioAPI {
  productInfo(): Promise<ProductInfo>
  toolchainStatus(): Promise<ToolchainStatus>
  selectCLIExecutable(): Promise<string>
  configureCLIExecutable(path: string): Promise<ToolchainStatus>
  clientPreferences(): Promise<ClientPreferences>
  saveClientPreferences(theme: ThemePreference): Promise<void>
  saveClientLocale(locale: Locale): Promise<void>
  listProjects(): Promise<Project[]>
  selectProjectCreationDirectory(): Promise<string>
  openProject(root: string): Promise<Workspace>
  createProject(root: string, id: string, name: string): Promise<Workspace>
  workspace(): Promise<Workspace>
  readWorkspaceState(): Promise<WorkspaceState>
  writeWorkspaceState(state: WorkspaceState): Promise<void>
  openFileExternally(path: string, application: string): Promise<void>
  editorAssociations(): Promise<EditorAssociation[]>
  selectExternalEditor(): Promise<string>
  saveEditorAssociation(pattern: string, application: string): Promise<void>
  removeEditorAssociation(pattern: string): Promise<void>
  readProjectSchema(projectId: string, serviceId: string): Promise<Uint8Array>
  importServiceSettingsSchema(projectId: string, serviceId: string): Promise<Workspace>
  previewServiceSettingsSchema(projectId: string, serviceId: string, patchJson: string): Promise<ServiceSettingsSchemaPreview>
  refreshServiceSettingsSchema(projectId: string, serviceId: string, preview: ServiceSettingsSchemaPreview, patchJson: string): Promise<Workspace>
  readProjectSettings(projectId: string, serviceId: string): Promise<ProjectSettingsSnapshot>
  writeProjectSettings(projectId: string, serviceId: string, expectedDigest: string, patch: Uint8Array): Promise<void>
  writeProjectCandidateSettings?(projectId: string, serviceId: string, expectedDigest: string, patch: Uint8Array): Promise<void>
  readServiceSettingsDraft(projectId: string, serviceId: string): Promise<PersistedServiceSettingsDraft | null>
  saveServiceSettingsDraft(projectId: string, serviceId: string, baseDigest: string, patchJson: string): Promise<void>
  deleteServiceSettingsDraft(projectId: string, serviceId: string): Promise<void>
  runStudioCommand(command: string, target?: string, operationID?: string, profilePath?: string): Promise<void>
  runStudioCommandAndWait(command: string, target?: string, operationID?: string, profilePath?: string): Promise<void>
  runStudioRuntimeCommand(command: string, serviceID: string): Promise<void>
  createRuntimeService(input: RuntimeServiceInput): Promise<Workspace>
  deleteRuntimeService(id: string, confirmed: boolean): Promise<Workspace>
  createServiceLink(input: ServiceLinkInput): Promise<Workspace>
  updateServiceLink(input: ServiceLinkInput): Promise<Workspace>
  deleteServiceLink(caller: string, id: string, confirmed: boolean): Promise<Workspace>
  selectTargetProfile(): Promise<string>
  cancelCLI(): Promise<void>
  listRuntimeArtifacts(): Promise<ArtifactReference[]>
  registerRuntimeArtifact(id: string, version: string, platform: string, binaryPath: string): Promise<ArtifactReference>
  trustRuntimeArtifact(id: string, version: string, platform: string, digest: string): Promise<ArtifactReference>
  removeRuntimeArtifact(id: string, version: string, platform: string, digest: string, confirmed: boolean): Promise<void>
  bindRuntimeServiceArtifact(projectId: string, serviceId: string, version: string, platform: string): Promise<Workspace>
  readRuntimeServiceMetadata(projectId: string, serviceID: string, view: 'manifest' | 'schema' | 'status'): Promise<string>
  readRuntimeServiceAdminSurface?(projectId: string, serviceID: string): Promise<string>
  selectRuntimeServiceResourceArtifact?(projectId: string, serviceID: string): Promise<string>
  selectRuntimeServiceProjectDirectory?(projectId: string, serviceID: string): Promise<string>
  importRuntimeServiceProjectCertificate?(projectId: string, serviceID: string, resourceID: string): Promise<string>
  publishRuntimeServiceResourceJSON?(projectId: string, serviceID: string, pageID: string, actionID: string, artifactPath: string, contentType: string, metadataJSON: string, ifMatch: string): Promise<string>
  readRuntimeServiceResource?(projectId: string, serviceID: string, resourceID: string): Promise<string>
  readLocalServiceSecretReferences?(serviceID: string): Promise<string>
  registerLocalServiceSecret?(serviceID: string, reference: string, confirmed: boolean): Promise<void>
  createLocalServiceSecret?(serviceID: string, purpose: string, label: string, secret: number[], confirmed: boolean): Promise<string>
  rotateLocalServiceSecret?(serviceID: string, reference: string, purpose: string, label: string, secret: number[], confirmed: boolean): Promise<string>
  revokeLocalServiceSecret?(serviceID: string, reference: string, confirmed: boolean): Promise<void>
  onCLIEvent(callback: (event: CLIEvent) => void): () => void
  trafficRecords(): Promise<TrafficRecordView[]>
  latestReportSummary(): Promise<ReportSummary | null>
  exportTrafficReport(): Promise<string>
  selectStudioPluginPackage(): Promise<string>
  inspectStudioPlugin(packagePath: string): Promise<string>
  installStudioPlugin(packagePath: string, expectedDigest: string, approved: boolean, reason: string, grantedPermissions: string[]): Promise<string>
  removeStudioPlugin(studioPluginId: string, version: string): Promise<void>
  diagnostics(): Promise<Diagnostic[]>
  installedStudioPlugins(): Promise<InstalledStudioPluginState[]>
  installedStudioPluginManifests(): Promise<string>
  studioPluginEditorBindings(): Promise<string>
  saveStudioPluginEditorBindings(bindings: string): Promise<void>
  readStudioPluginSurface(studioPluginId: string, version: string, surfaceId: string): Promise<string>
  runStudioPluginTool(studioPluginId: string, version: string, toolId: string, args: string[]): Promise<string>
  startStudioPluginProcess(studioPluginId: string, version: string): Promise<string>
  stopStudioPluginProcess(studioPluginId: string, version: string): Promise<void>
  studioPluginProcessStatus(studioPluginId: string, version: string): Promise<string>
  selectRuntimeArtifactBinary(): Promise<string>
  inspectCoreBinary(binaryPath: string): Promise<string>
  updateLocalCoreBinary(binaryPath: string, digest: string, confirmed: boolean): Promise<string>
  readCoreSettings(): Promise<CoreSettingsView>
  updateCoreSettings(expectedRevision: number, maxBodyBytes: number, headerTimeout: string, requestTimeout: string): Promise<CoreSettingsView>
}

export interface ProjectSettingsSnapshot {
  valuesJson: string
  digest: string
  configurationDigest?: string
}

export interface PersistedServiceSettingsDraft {
  serviceId: string
  settingsPath: string
  schemaPath: string
  baseDigest: string
  patchJson: string
}

export interface ArtifactReference {
  id: string
  version: string
  platform: string
  digest: string
  trusted: boolean
  command?: string
  manifest?: string
  schema?: string
}

export type RuntimeServiceReadiness = 'ready' | 'degraded' | 'not-ready' | 'unknown'
export type RuntimeConfigurationState = 'unconfigured' | 'unobserved' | 'pending' | 'acknowledged' | 'stale' | 'failed' | 'unreachable'

export interface RuntimeReplicaStatus {
  replicaId: string
  artifactVersion: string
  artifactDigest: string
  ready: boolean
  generation: string
  pendingGeneration: string
  schemaVersion: string
  desiredGeneration: number | null
  appliedGeneration: number | null
  configurationState: RuntimeConfigurationState
  configurationDigest?: string
  lastFailureCode: string
}

export type ThemePreference = 'system' | 'light' | 'dark'
export type Locale = 'ru' | 'en'
export interface ClientPreferences { theme: ThemePreference; locale: Locale }

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

export interface ReportSummary {
  operationId: string
  target: string
  commitSha: string
  generation: string
  bundleDigest: string
  cliVersion: string
  coreApiCompatibility: string
  importedAt: string
  replicaCount: number
  readyReplicas: number
  state: string
}

export interface InstalledStudioPluginState {
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

export interface Workspace {
  project: Project | null
  files: ProjectFile[]
  graph: ServiceGraph
}

export interface WorkspaceState {
  projectId: string
  layoutJson: string
  tabsJson: string
  filtersJson: string
}

export interface RuntimeServiceInput {
  id: string
  name: string
  version: string
  manifestVersion: string
  settingsSchemaPath: string
}

export interface ServiceLinkInput {
  id: string
  caller: string
  target: string
  contractVersion: string
  methods: string[]
  transport: string
  requestSchemaPath: string
  responseSchemaPath: string
  contractSchemaPath: string
  securityProfile: string
  timeoutMillis: number
  retryLimit: number
  requestLimitBytes: number
  responseLimitBytes: number
  disabledMethods: string[]
  compatibility: string
  redactionPolicy: string
}

export interface RuntimeService {
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
}

export interface ServiceArtifactReference {
  id: string
  version: string
  platform: string
  digest: string
}

export interface ServiceLink {
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

export interface ServiceGraph {
  services: RuntimeService[]
  links: ServiceLink[]
}
