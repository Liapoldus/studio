import { CancelCLI, ClientPreferences as ReadClientPreferences, Diagnostics, EditorAssociations as ReadEditorAssociations, ExportTrafficReport, GitBranches, GitCheckout, GitCommit as RunGitCommit, GitDiff as ReadGitDiff, GitHistory, GitPull, GitPush, GitRemotes, InspectStudioPlugin, InstallStudioPlugin, InstalledStudioPluginManifests, InstalledStudioPlugins, ListProjects, OpenFileExternally, OpenProject, PrepareRemoteHandoff, ProductInfo, ReadProjectFile, ReadProjectSchema, ReadProjectSettings, ReadStudioPluginSurface, ReadWorkspaceState, RemoveStudioPlugin, RunCLI, RunStudioPluginTool, SaveClientPreferences, SaveEditorAssociation, SelectExternalEditor, SelectStudioPluginPackage, StartStudioPluginProcess, StopStudioPluginProcess, StudioPluginProcessStatus, TrafficRecords, Workspace as ReadWorkspace, WriteProjectFile, WriteProjectSettings, WriteWorkspaceState } from '../../wailsjs/go/wails/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { Diagnostic as DiagnosticDataModel, GitBranch, GitCommit, GitDiff, GitRemote, InstalledPluginState, ProductInfo as ProductInfoData, Project, TrafficRecordView, Workspace as WorkspaceData, WorkspaceState } from './info'
import type { CLIEvent, ClientPreferences, EditorAssociation, StudioAPI } from './types'

export async function selectProjectDirectory(): Promise<string> {
  const { SelectProjectDirectory } = await import('../../wailsjs/go/wails/App')
  return SelectProjectDirectory()
}

export function createWailsStudioAPI(): StudioAPI {
  return {
    async productInfo() {
      return new ProductInfoData(await ProductInfo())
    },
    async clientPreferences() {
      return JSON.parse(await ReadClientPreferences()) as ClientPreferences
    },
    saveClientPreferences(theme) {
      return SaveClientPreferences(theme)
    },
    async listProjects() {
      return (await ListProjects()).map((project) => new Project(project))
    },
    async openProject(root) {
      return new WorkspaceData(await OpenProject(root))
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
      return Uint8Array.from(await ReadProjectFile(path))
    },
    writeProjectFile(path, content) {
      return WriteProjectFile(path, Array.from(content))
    },
    async readProjectSchema(schemaPath) {
      return Uint8Array.from(await ReadProjectSchema(schemaPath))
    },
    async readProjectSettings(settingsPath, schemaPath) {
      return Uint8Array.from(await ReadProjectSettings(settingsPath, schemaPath))
    },
    writeProjectSettings(settingsPath, schemaPath, patch) {
      return WriteProjectSettings(settingsPath, schemaPath, Array.from(patch))
    },
    runCLI(args) {
      return RunCLI(args)
    },
    cancelCLI() {
      return CancelCLI()
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
  }
}

function isCLIEvent(value: unknown): value is CLIEvent {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value && typeof value.schemaVersion === 'string' && 'type' in value && typeof value.type === 'string'
}
