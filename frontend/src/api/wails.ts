import { BindRuntimeServiceArtifact, CancelCLI, ClientPreferences as ReadClientPreferences, ConfigureCLIExecutable, CreateLocalServiceSecret, RotateLocalServiceSecret, RegisterLocalServiceSecret, CreateServiceLink, CreateProject, CreateRuntimeService, CreateServiceSettingsRecoveryCopy, DeleteServiceLink, DeleteRuntimeService, DeleteServiceSettingsDraft, Diagnostics, EditorAssociations as ReadEditorAssociations, ExportTrafficReport, ImportServiceSettingsSchema, PreviewServiceSettingsSchema, RefreshServiceSettingsSchema, InspectCoreBinary, InspectStudioPlugin, InstallStudioPlugin, InstalledStudioPluginManifests, InstalledStudioPlugins, LatestReportSummary, ListProjects, ListRuntimeArtifacts, OpenFileExternally, OpenProject, ProductInfo, PublishRuntimeServiceResourceJSON, ReadCoreSettings as ReadCoreSettingsView, ReadLocalServiceSecretReferences, ReadProjectSchema, ReadProjectSettings, ReadRuntimeServiceMetadata, ReadRuntimeServiceAdminSurface, ReadRuntimeServiceAdminTable, InvokeRuntimeServiceAdminAction, ReadRuntimeServiceResource, ReadServiceSettingsDraft, ReadStudioPluginSurface, ReadWorkspaceState, RemoveEditorAssociation, RemoveRuntimeArtifact, RemoveStudioPlugin, RevokeLocalServiceSecret, RunStudioCommand, RunStudioCommandAndWait, RunStudioRuntimeCommand, RunStudioPluginTool, SaveClientLocale, SaveClientPreferences, SaveEditorAssociation, SaveServiceSettingsDraft, SelectCLIExecutable, SelectExternalEditor, SelectProjectCreationDirectory, SelectProjectDirectory, SelectRuntimeServiceResourceArtifact, SelectRuntimeServiceProjectDirectory, ImportRuntimeServiceProjectCertificate, SelectRuntimeArtifactBinary, SelectStudioPluginPackage, SelectTargetProfile, StartStudioPluginProcess, StopStudioPluginProcess, StudioPluginProcessStatus, ToolchainStatus as ReadToolchainStatus, TrafficRecords, TrustRuntimeArtifact, RegisterRuntimeArtifact, UpdateCoreSettings as ApplyCoreSettings, UpdateLocalCoreBinary, UpdateServiceLink, Workspace as ReadWorkspace, WriteProjectCandidateSettings, WriteProjectSettings, WriteWorkspaceState } from '../../wailsjs/go/wails/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { SaveStudioPluginEditorBindings, StudioPluginEditorBindings } from '../../wailsjs/go/wails/App'
import { Diagnostic as DiagnosticDataModel, InstalledStudioPluginState, ProductInfo as ProductInfoData, Project, ServiceSettingsSchemaPreview as ServiceSettingsSchemaPreviewData, TrafficRecordView, Workspace as WorkspaceData, WorkspaceState } from './info'
import { decodeWailsBytes } from './bytes'
import type { CLIEvent, ClientPreferences, EditorAssociation, Locale, PersistedServiceSettingsDraft, ProjectSettingsRecoveryCopy, ProjectSettingsSnapshot, ServiceLinkInput, RuntimeServiceInput, StudioAPI } from './types'
import { parseCoreSettingsView } from '../models/coreSettings'

export function selectProjectDirectory(): Promise<string> {
  return SelectProjectDirectory()
}

export async function selectProjectCreationDirectory(): Promise<string> {
	return SelectProjectCreationDirectory()
}

export function createWailsStudioAPI(): StudioAPI {
  return {
    async productInfo() {
      return new ProductInfoData(await ProductInfo())
    },
    toolchainStatus() {
      return ReadToolchainStatus()
    },
    selectCLIExecutable() {
      return SelectCLIExecutable()
    },
    configureCLIExecutable(path) {
      return ConfigureCLIExecutable(path)
    },
    async clientPreferences() {
      return JSON.parse(await ReadClientPreferences()) as ClientPreferences
    },
    saveClientPreferences(theme) {
      return SaveClientPreferences(theme)
    },
    saveClientLocale(locale: Locale) {
      return SaveClientLocale(locale)
    },
    async listProjects() {
      return (await ListProjects()).map((project) => new Project(project))
    },
    selectProjectCreationDirectory() {
      return SelectProjectCreationDirectory()
    },
    async openProject(root) {
      return new WorkspaceData(await OpenProject(root))
    },
    async createProject(root, id, name) {
      return new WorkspaceData(await CreateProject(root, id, name))
    },
    async workspace() {
      return new WorkspaceData(await ReadWorkspace())
    },
    async readWorkspaceState() {
      return new WorkspaceState(await ReadWorkspaceState())
    },
    writeWorkspaceState(state) {
      return WriteWorkspaceState(state)
    },
    openFileExternally(path, application) {
      return OpenFileExternally(path, application)
    },
    async editorAssociations() {
      return JSON.parse(await ReadEditorAssociations()) as EditorAssociation[]
    },
    selectExternalEditor() {
      return SelectExternalEditor()
    },
    saveEditorAssociation(pattern, application) {
      return SaveEditorAssociation(pattern, application)
    },
    removeEditorAssociation(pattern) {
      return RemoveEditorAssociation(pattern)
    },
    async readProjectSettings(projectID, serviceID) {
      return parseSettingsSnapshot(await ReadProjectSettings(projectID, serviceID))
    },
    writeProjectSettings(projectID, serviceID, expectedDigest, patch) {
      return WriteProjectSettings(projectID, serviceID, expectedDigest, Array.from(patch))
    },
    writeProjectCandidateSettings(projectID, serviceID, expectedDigest, patch) {
      return WriteProjectCandidateSettings(projectID, serviceID, expectedDigest, Array.from(patch))
    },
    createServiceSettingsRecoveryCopy(projectID, serviceID, expectedDigest): Promise<ProjectSettingsRecoveryCopy> {
      return CreateServiceSettingsRecoveryCopy(projectID, serviceID, expectedDigest)
    },
    async readServiceSettingsDraft(projectID, serviceID) {
      const encoded = await ReadServiceSettingsDraft(projectID, serviceID)
      return encoded ? parsePersistedSettingsDraft(encoded) : null
    },
    saveServiceSettingsDraft(projectID, serviceID, baseDigest, patchJson) {
      return SaveServiceSettingsDraft(projectID, serviceID, baseDigest, patchJson)
    },
    deleteServiceSettingsDraft(projectID, serviceID) {
      return DeleteServiceSettingsDraft(projectID, serviceID)
    },
    async readProjectSchema(projectID, serviceID) {
      return decodeWailsBytes(await ReadProjectSchema(projectID, serviceID))
    },
    async importServiceSettingsSchema(projectID, serviceID) {
      return new WorkspaceData(await ImportServiceSettingsSchema(projectID, serviceID))
    },
    async previewServiceSettingsSchema(projectID, serviceID, patchJSON) {
      return new ServiceSettingsSchemaPreviewData(await PreviewServiceSettingsSchema(projectID, serviceID, patchJSON))
    },
    async refreshServiceSettingsSchema(projectID, serviceID, preview, patchJSON) {
      return new WorkspaceData(await RefreshServiceSettingsSchema(projectID, serviceID, JSON.stringify(preview), patchJSON))
    },
    runStudioCommand(command, target, operationID, profilePath) {
      return RunStudioCommand(command, target ?? '', operationID ?? '', profilePath ?? '')
    },
    runStudioCommandAndWait(command, target, operationID, profilePath) {
      return RunStudioCommandAndWait(command, target ?? '', operationID ?? '', profilePath ?? '')
    },
    runStudioRuntimeCommand(command, serviceID) { return RunStudioRuntimeCommand(command, serviceID) },
    createRuntimeService(input: RuntimeServiceInput) {
      return CreateRuntimeService(input).then((value) => new WorkspaceData(value))
    },
    deleteRuntimeService(id, confirmed) {
      return DeleteRuntimeService(id, confirmed).then((value) => new WorkspaceData(value))
    },
    createServiceLink(input: ServiceLinkInput) {
      return CreateServiceLink(input).then((value) => new WorkspaceData(value))
    },
    updateServiceLink(input: ServiceLinkInput) {
      return UpdateServiceLink(input).then((value) => new WorkspaceData(value))
    },
    deleteServiceLink(caller, id, confirmed) {
      return DeleteServiceLink(caller, id, confirmed).then((value) => new WorkspaceData(value))
    },
    selectTargetProfile() {
      return SelectTargetProfile()
    },
    cancelCLI() {
      return CancelCLI()
    },
    async listRuntimeArtifacts() {
      return (await ListRuntimeArtifacts()).map((value) => value)
    },
    async registerRuntimeArtifact(id, version, platform, binaryPath) {
      return (await RegisterRuntimeArtifact(id, version, platform, binaryPath))
    },
    async trustRuntimeArtifact(id, version, platform, digest) {
      return (await TrustRuntimeArtifact(id, version, platform, digest))
    },
    removeRuntimeArtifact(id, version, platform, digest, confirmed) {
      return RemoveRuntimeArtifact(id, version, platform, digest, confirmed)
    },
    async bindRuntimeServiceArtifact(projectID, serviceID, version, platform) {
      return new WorkspaceData(await BindRuntimeServiceArtifact(projectID, serviceID, version, platform))
    },
    readRuntimeServiceMetadata(projectID, serviceID, view) {
      return ReadRuntimeServiceMetadata(projectID, serviceID, view)
    },
    readRuntimeServiceAdminSurface(projectID, serviceID) {
      return ReadRuntimeServiceAdminSurface(projectID, serviceID)
    },
    readRuntimeServiceAdminTable(projectID, serviceID, pageID, sectionID, surfaceDigest, cursor) {
      return ReadRuntimeServiceAdminTable(projectID, serviceID, pageID, sectionID, surfaceDigest, cursor)
    },
    invokeRuntimeServiceAdminAction(projectID, serviceID, pageID, sectionID, actionID, inputJSON, ifMatch, surfaceDigest) {
      return InvokeRuntimeServiceAdminAction(projectID, serviceID, pageID, sectionID, actionID, inputJSON, ifMatch, surfaceDigest)
    },
    selectRuntimeServiceResourceArtifact(projectID, serviceID) {
      return SelectRuntimeServiceResourceArtifact(projectID, serviceID)
    },
    selectRuntimeServiceProjectDirectory(projectID, serviceID) {
      return SelectRuntimeServiceProjectDirectory(projectID, serviceID)
    },
    importRuntimeServiceProjectCertificate(projectID, serviceID, resourceID) {
      return ImportRuntimeServiceProjectCertificate(projectID, serviceID, resourceID)
    },
    publishRuntimeServiceResourceJSON(projectID, serviceID, pageID, actionID, artifactPath, contentType, metadataJSON, ifMatch) {
      return PublishRuntimeServiceResourceJSON(projectID, serviceID, pageID, actionID, artifactPath, contentType, metadataJSON, ifMatch)
    },
    readRuntimeServiceResource(projectID, serviceID, resourceID) {
      return ReadRuntimeServiceResource(projectID, serviceID, resourceID)
    },
    readLocalServiceSecretReferences(serviceID) {
      return ReadLocalServiceSecretReferences(serviceID)
    },
    registerLocalServiceSecret(serviceID, reference, confirmed) {
      return RegisterLocalServiceSecret(serviceID, reference, confirmed)
    },
    createLocalServiceSecret(serviceID, purpose, label, secret, confirmed) {
      return CreateLocalServiceSecret(serviceID, purpose, label, secret, confirmed)
    },
    rotateLocalServiceSecret(serviceID, reference, purpose, label, secret, confirmed) {
      return RotateLocalServiceSecret(serviceID, reference, purpose, label, secret, confirmed)
    },
    revokeLocalServiceSecret(serviceID, reference, confirmed) {
      return RevokeLocalServiceSecret(serviceID, reference, confirmed)
    },
    onCLIEvent(callback) {
      return EventsOn('studio.cli.event', (...data: unknown[]) => {
        const event = data[0]
        if (isCLIEvent(event)) callback(event)
      })
    },
    async trafficRecords() {
      return (await TrafficRecords()).map((record) => new TrafficRecordView(record))
    },
    async latestReportSummary() {
      const summary = await LatestReportSummary()
      return summary.state ? summary : null
    },
    exportTrafficReport() {
      return ExportTrafficReport()
    },
    selectStudioPluginPackage() {
      return SelectStudioPluginPackage()
    },
    inspectStudioPlugin(packagePath) {
      return InspectStudioPlugin(packagePath)
    },
    installStudioPlugin(packagePath, expectedDigest, approved, reason, grantedPermissions) {
      return InstallStudioPlugin(packagePath, expectedDigest, approved, reason, grantedPermissions)
    },
    removeStudioPlugin(studioPluginId, version) {
      return RemoveStudioPlugin(studioPluginId, version)
    },
    async diagnostics() {
      return (await Diagnostics()).map((diagnostic) => new DiagnosticDataModel(diagnostic))
    },
    async installedStudioPlugins() {
      return (await InstalledStudioPlugins()).map((plugin) => new InstalledStudioPluginState(plugin))
    },
    installedStudioPluginManifests() {
      return InstalledStudioPluginManifests()
    },
    studioPluginEditorBindings() { return StudioPluginEditorBindings() },
    saveStudioPluginEditorBindings(bindings) { return SaveStudioPluginEditorBindings(bindings) },
    readStudioPluginSurface(studioPluginId, version, surfaceId) {
      return ReadStudioPluginSurface(studioPluginId, version, surfaceId)
    },
    runStudioPluginTool(studioPluginId, version, toolId, args) {
      return RunStudioPluginTool(studioPluginId, version, toolId, args)
    },
    startStudioPluginProcess(studioPluginId, version) {
      return StartStudioPluginProcess(studioPluginId, version)
    },
    stopStudioPluginProcess(studioPluginId, version) {
      return StopStudioPluginProcess(studioPluginId, version)
    },
    studioPluginProcessStatus(studioPluginId, version) {
      return StudioPluginProcessStatus(studioPluginId, version)
    },
    selectRuntimeArtifactBinary() { return SelectRuntimeArtifactBinary() },
    inspectCoreBinary(binaryPath) { return InspectCoreBinary(binaryPath) },
    updateLocalCoreBinary(binaryPath, digest, confirmed) { return UpdateLocalCoreBinary(binaryPath, digest, confirmed) },
    async readCoreSettings() { return parseCoreSettingsView(await ReadCoreSettingsView()) },
    async updateCoreSettings(expectedRevision, maxBodyBytes, headerTimeout, requestTimeout) {
      return parseCoreSettingsView(await ApplyCoreSettings(expectedRevision, maxBodyBytes, headerTimeout, requestTimeout))
    },
  }
}

function parseSettingsSnapshot(encoded: string): ProjectSettingsSnapshot {
  const value: unknown = JSON.parse(encoded)
  if (typeof value !== 'object' || value === null || !('valuesJson' in value) || typeof value.valuesJson !== 'string' ||
    !('digest' in value) || typeof value.digest !== 'string') throw new Error('Invalid project settings snapshot')
  return { valuesJson: value.valuesJson, digest: value.digest,
    ...('configurationDigest' in value && typeof value.configurationDigest === 'string' ? { configurationDigest: value.configurationDigest } : {}) }
}

function parsePersistedSettingsDraft(encoded: string): PersistedServiceSettingsDraft {
  const value: unknown = JSON.parse(encoded)
  if (typeof value !== 'object' || value === null ||
    !('serviceId' in value) || typeof value.serviceId !== 'string' ||
    !('settingsPath' in value) || typeof value.settingsPath !== 'string' ||
    !('schemaPath' in value) || typeof value.schemaPath !== 'string' ||
    !('baseDigest' in value) || typeof value.baseDigest !== 'string' ||
    !('patchJson' in value) || typeof value.patchJson !== 'string') throw new Error('Invalid persisted settings draft')
  return { serviceId: value.serviceId, settingsPath: value.settingsPath, schemaPath: value.schemaPath, baseDigest: value.baseDigest, patchJson: value.patchJson }
}

function isCLIEvent(value: unknown): value is CLIEvent {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value && typeof value.schemaVersion === 'string' && 'type' in value && typeof value.type === 'string'
}
