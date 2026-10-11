import { CancelCLI, ClientPreferences as ReadClientPreferences, CreatePluginLink, CreateProject, CreateRuntimePlugin, DeletePluginLink, DeleteRuntimePlugin, Diagnostics, EditorAssociations as ReadEditorAssociations, ExportTrafficReport, GitAbort, GitApplyStash, GitBranches, GitCheckout, GitCherryPick, GitCommit as RunGitCommit, GitCommitStaged, GitConflict as ReadGitConflict, GitDiff as ReadGitDiff, GitHistory, GitMerge, GitPull, GitPush, GitRebase, GitRemotes, GitResolveConflict, GitStage, GitStash, GitStashes, GitUnstage, InitializeGit, InspectStudioPlugin, InstallStudioPlugin, InstalledStudioPluginManifests, InstalledStudioPlugins, ListProjects, ListRuntimeArtifacts, OpenFileExternally, OpenProject, PrepareRemoteHandoff, ProductInfo, ReadProjectFile, ReadProjectSchema, ReadProjectSettings, ReadRuntimePluginMetadata, ReadStudioPluginSurface, ReadWorkspaceState, RemoveStudioPlugin, RunStudioCommand, RunStudioRuntimeCommand, RunStudioPluginTool, SaveClientLocale, SaveClientPreferences, SaveEditorAssociation, SelectExternalEditor, SelectProjectCreationDirectory, SelectRuntimeArtifactBinary, SelectStudioPluginPackage, SelectTargetProfile, StartStudioPluginProcess, StopStudioPluginProcess, StudioPluginProcessStatus, ToolchainStatus as ReadToolchainStatus, TrafficRecords, TrustRuntimeArtifact, RegisterRuntimeArtifact, Workspace as ReadWorkspace, WriteProjectFile, WriteProjectSettings, WriteWorkspaceState } from '../../wailsjs/go/wails/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { Diagnostic as DiagnosticDataModel, GitBranch, GitCommit, GitConflict, GitDiff, GitRemote, GitStash as GitStashDataModel, InstalledPluginState, ProductInfo as ProductInfoData, Project, TrafficRecordView, Workspace as WorkspaceData, WorkspaceState } from './info'
import { decodeWailsBytes } from './bytes'
import type { CLIEvent, ClientPreferences, EditorAssociation, Locale, PluginLinkInput, RuntimePluginInput, StudioAPI } from './types'

export async function selectProjectDirectory(): Promise<string> {
  const { SelectProjectDirectory } = await import('../../wailsjs/go/wails/App')
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
    async readProjectFile(path) {
      return decodeWailsBytes(await ReadProjectFile(path))
    },
    writeProjectFile(path, content) {
      return WriteProjectFile(path, Array.from(content))
    },
    async readProjectSchema(schemaPath) {
      return decodeWailsBytes(await ReadProjectSchema(schemaPath))
    },
    async readProjectSettings(settingsPath, schemaPath) {
      return decodeWailsBytes(await ReadProjectSettings(settingsPath, schemaPath))
    },
    writeProjectSettings(settingsPath, schemaPath, patch) {
      return WriteProjectSettings(settingsPath, schemaPath, Array.from(patch))
    },
    runStudioCommand(command, target, operationID, profilePath) {
      return RunStudioCommand(command, target ?? '', operationID ?? '', profilePath ?? '')
    },
    runStudioRuntimeCommand(command, serviceID) { return RunStudioRuntimeCommand(command, serviceID) },
    initializeGit() {
      return InitializeGit().then((value) => new WorkspaceData(value))
    },
    createRuntimePlugin(input: RuntimePluginInput) {
      return CreateRuntimePlugin(input).then((value) => new WorkspaceData(value))
    },
    deleteRuntimePlugin(id, confirmed) {
      return DeleteRuntimePlugin(id, confirmed).then((value) => new WorkspaceData(value))
    },
    createPluginLink(input: PluginLinkInput) {
      return CreatePluginLink(input).then((value) => new WorkspaceData(value))
    },
    deletePluginLink(caller, id, confirmed) {
      return DeletePluginLink(caller, id, confirmed).then((value) => new WorkspaceData(value))
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
    readRuntimePluginMetadata(pluginID, view) {
      return ReadRuntimePluginMetadata(pluginID, view)
    },
    prepareRemoteHandoff(target) {
      return PrepareRemoteHandoff(target)
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
    exportTrafficReport() {
      return ExportTrafficReport()
    },
    selectStudioPluginPackage() {
      return SelectStudioPluginPackage()
    },
    inspectStudioPlugin(packagePath) {
      return InspectStudioPlugin(packagePath)
    },
    installStudioPlugin(packagePath, approved, reason, grantedPermissions) {
      return InstallStudioPlugin(packagePath, approved, reason, grantedPermissions)
    },
    removeStudioPlugin(pluginId, version) {
      return RemoveStudioPlugin(pluginId, version)
    },
    async diagnostics() {
      return (await Diagnostics()).map((diagnostic) => new DiagnosticDataModel(diagnostic))
    },
    async installedStudioPlugins() {
      return (await InstalledStudioPlugins()).map((plugin) => new InstalledPluginState(plugin))
    },
    installedStudioPluginManifests() {
      return InstalledStudioPluginManifests()
    },
    readStudioPluginSurface(pluginId, version, surfaceId) {
      return ReadStudioPluginSurface(pluginId, version, surfaceId)
    },
    runStudioPluginTool(pluginId, version, toolId, args) {
      return RunStudioPluginTool(pluginId, version, toolId, args)
    },
    startStudioPluginProcess(pluginId, version) {
      return StartStudioPluginProcess(pluginId, version)
    },
    stopStudioPluginProcess(pluginId, version) {
      return StopStudioPluginProcess(pluginId, version)
    },
    studioPluginProcessStatus(pluginId, version) {
      return StudioPluginProcessStatus(pluginId, version)
    },
    async gitDiff(path) {
      return new GitDiff(await ReadGitDiff(path))
    },
    async gitConflict(path) {
      return new GitConflict(await ReadGitConflict(path))
    },
    gitResolveConflict(path, side, confirmed) {
      return GitResolveConflict(path, side, confirmed)
    },
    gitStage(paths, confirmed) {
      return GitStage(paths, confirmed)
    },
    gitUnstage(paths, confirmed) {
      return GitUnstage(paths, confirmed)
    },
    gitCommitStaged(message, confirmed) {
      return GitCommitStaged(message, confirmed)
    },
    async gitStashes(limit) {
      return (await GitStashes(limit)).map((stash) => new GitStashDataModel(stash))
    },
    gitStash(message, includeUntracked, confirmed) {
      return GitStash(message, includeUntracked, confirmed)
    },
    gitApplyStash(index, drop, confirmed) {
      return GitApplyStash(index, drop, confirmed)
    },
    async gitBranches() {
      return (await GitBranches()).map((branch) => new GitBranch(branch))
    },
    async gitHistory(limit) {
      return (await GitHistory(limit)).map((commit) => new GitCommit(commit))
    },
    async gitRemotes() {
      return (await GitRemotes()).map((remote) => new GitRemote(remote))
    },
    gitCheckout(branch, confirmed) {
      return GitCheckout(branch, confirmed)
    },
    gitCommit(message, paths, confirmed) {
      return RunGitCommit(message, paths, confirmed)
    },
    gitPull(remote, branch, confirmed) {
      return GitPull(remote, branch, confirmed)
    },
    gitPush(remote, branch, confirmed) {
      return GitPush(remote, branch, confirmed)
    },
    gitMerge(branch, confirmed) {
      return GitMerge(branch, confirmed)
    },
    gitRebase(branch, confirmed) {
      return GitRebase(branch, confirmed)
    },
    gitCherryPick(commit, confirmed) {
      return GitCherryPick(commit, confirmed)
    },
    gitAbort(operation, confirmed) {
      return GitAbort(operation, confirmed)
    },
    selectRuntimeArtifactBinary() { return SelectRuntimeArtifactBinary() },
  }
}

function isCLIEvent(value: unknown): value is CLIEvent {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value && typeof value.schemaVersion === 'string' && 'type' in value && typeof value.type === 'string'
}
