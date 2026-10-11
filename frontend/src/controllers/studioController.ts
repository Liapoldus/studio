import type { Connection } from '@xyflow/react'
import type { ArtifactReference, PluginLinkInput, ProjectFile, RuntimePluginInput, StudioAPI, ThemePreference } from '../api/types'
import { selectProjectCreationDirectory } from '../api/wails'
import { emptyDocuments, messageOf, restoreWorkspaceState, workspaceSnapshot, type LayoutPoint, type Locale } from '../models/studio'
import { parsePluginReadiness } from '../models/runtime'
import { useStudioStore } from '../stores/studio'

export type StudioController = ReturnType<typeof createStudioController>

export function createStudioController(api: StudioAPI) {
  const store = () => useStudioStore.getState()
  let operationSerial = 0
  let runtimeStatusSerial = 0
  function beginOperation(): number { const serial = ++operationSerial; store().setBusy(true); return serial }
  function isCurrent(serial: number): boolean { return serial === operationSerial }
  function fail(reason: unknown, fallback: string): void { store().setError(messageOf(reason, fallback)) }

  async function refresh() {
    const serial = beginOperation(); store().setError(null)
    try {
      const [projects, workspace, preferences, toolchain] = await Promise.all([api.listProjects(), api.workspace(), api.clientPreferences(), api.toolchainStatus()])
      if (!isCurrent(serial)) return
      if (store().workspace?.project?.id !== workspace.project?.id) store().setRuntimeStatuses({})
      store().setProjects(projects); store().setWorkspace(workspace); store().setLocaleState(preferences.locale); store().setThemeState(preferences.theme); store().setToolchain(toolchain)
      if (!workspace.project) { store().setScreen('home'); store().setDocuments(emptyDocuments()); store().setStateHydrated(false); return }
      const restored = await restoreWorkspaceState(api)
      if (!isCurrent(serial)) return
      store().setDocuments(restored.documents); store().setActiveDocument(restored.activeDocument); store().setScreen(restored.screen); store().setDock(restored.dock); store().setLayout(restored.layout); store().setStateHydrated(true)
    } catch (reason: unknown) { if (isCurrent(serial)) fail(reason, 'Не удалось загрузить Studio') } finally { if (isCurrent(serial)) store().setBusy(false); store().setInitialized(true) }
  }

  async function refreshGraph() {
    await refresh()
    await refreshRuntimeStatuses()
  }

  async function refreshRuntimeStatuses() {
    const serial = ++runtimeStatusSerial
    const workspace = store().workspace
    if (!workspace?.project) { store().setRuntimeStatuses({}); return }
    const projectID = workspace.project.id
    const statuses: Record<string, ReturnType<typeof parsePluginReadiness>> = {}
    for (const plugin of workspace.graph.plugins) {
      if (serial !== runtimeStatusSerial) return
      try { statuses[plugin.id] = parsePluginReadiness(await api.readRuntimePluginMetadata(plugin.id, 'status')) } catch { statuses[plugin.id] = 'unknown' }
      if (serial !== runtimeStatusSerial || store().workspace?.project?.id !== projectID) return
      store().setRuntimeStatuses({ ...statuses })
    }
  }

  async function openProject(root: string) {
    if (!root) return
    const serial = beginOperation(); store().setError(null); store().setStateHydrated(false)
    try {
      const workspace = await api.openProject(root); const restored = await restoreWorkspaceState(api)
      if (!isCurrent(serial)) return
      store().setRuntimeStatuses({}); store().setWorkspace(workspace); store().setDocuments(restored.documents); store().setActiveDocument(restored.activeDocument); store().setScreen(restored.screen); store().setDock(restored.dock); store().setLayout(restored.layout); store().setStateHydrated(true); store().setProjects(await api.listProjects())
    } catch (reason: unknown) { if (isCurrent(serial)) fail(reason, `Не удалось открыть проект: ${root}`) } finally { if (isCurrent(serial)) store().setBusy(false) }
  }

  async function createProject() {
    const state = store(); if (!state.projectID.trim() || !state.projectName.trim()) return
    store().setError(null)
    try {
      const parent = await selectProjectCreationDirectory(); if (!parent) return
      const serial = beginOperation(); store().setCreateOpen(false)
      const workspace = await api.createProject(parent, state.projectID.trim(), state.projectName.trim())
      if (!isCurrent(serial)) return
      store().setRuntimeStatuses({}); store().setWorkspace(workspace); store().setProjects(await api.listProjects()); store().setDocuments(emptyDocuments()); store().setActiveDocument('canvas'); store().setScreen('graph'); store().setStateHydrated(true); store().setCreateOpen(false); store().setField('projectID', ''); store().setField('projectName', '')
    } catch (reason: unknown) { fail(reason, 'Не удалось создать проект') } finally { store().setBusy(false) }
  }

  async function openFile(file: ProjectFile) {
    if (!/\.(yaml|yml|json|md|txt|toml|xml|csv)$/iu.test(file.path)) { try { await api.openFileExternally(file.path, '') } catch (reason: unknown) { fail(reason, `Не удалось открыть файл внешним редактором: ${file.path}`) }; return }
    try {
      const content = new TextDecoder().decode(await api.readProjectFile(file.path)); const document = { id: `file:${file.path}`, kind: 'file' as const, title: file.path.split('/').pop() ?? file.path, path: file.path, content, dirty: false }
      const documents = store().documents.some((item) => item.id === document.id) ? store().documents.map((item) => item.id === document.id ? document : item) : [...store().documents, document]
      store().setDocuments(documents); store().setActiveDocument(document.id); store().setError(null)
    } catch (reason: unknown) { fail(reason, `Не удалось открыть файл: ${file.path}`) }
  }

  async function saveDocument(id: string) {
    const document = store().documents.find((item) => item.id === id); if (!document?.path || document.content === undefined) return
    try { await api.writeProjectFile(document.path, new TextEncoder().encode(document.content)); store().setDocuments(store().documents.map((item) => item.id === id ? { ...item, dirty: false } : item)); store().setWorkspace(await api.workspace()); store().setError(null) } catch (reason: unknown) { fail(reason, `Не удалось сохранить файл: ${document.path}`) }
  }

  async function run(command: string, target = 'local') { store().setDock('cli'); store().setError(null); try { await api.runStudioCommand(command, command === 'target.list' ? '' : target) } catch (reason: unknown) { fail(reason, `Не удалось выполнить CLI-команду: ${command}`) } }
  async function initializeGit() { try { store().setWorkspace(await api.initializeGit()); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось инициализировать Git') } }

  async function addPlugin() {
    const state = store(); if (!state.pluginID.trim() || !state.pluginName.trim()) return
    const input: RuntimePluginInput = { id: state.pluginID.trim(), name: state.pluginName.trim(), version: '0.1.0', manifestVersion: 'v1', settingsSchemaPath: '' }
    try { store().setWorkspace(await api.createRuntimePlugin(input)); store().setPluginOpen(false); store().setField('pluginID', ''); store().setField('pluginName', ''); store().setSelected({ kind: 'plugin', id: input.id }); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось создать runtime plugin') }
  }

  async function createLink(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const input: PluginLinkInput = { id: `${connection.source}-${connection.target}`, caller: connection.source, target: connection.target, contractVersion: 'v1', methods: ['invoke'], transport: 'local', requestSchemaPath: '', responseSchemaPath: '', contractSchemaPath: '', securityProfile: 'default', timeoutMillis: 30000, retryLimit: 0, requestLimitBytes: 1048576, responseLimitBytes: 1048576, disabledMethods: [], compatibility: 'strict', redactionPolicy: 'schema' }
    try { store().setWorkspace(await api.createPluginLink(input)); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось создать связь') }
  }

  async function deleteNodes(ids: string[]) { try { let workspace = store().workspace; for (const id of ids) workspace = await api.deleteRuntimePlugin(id, true); store().setWorkspace(workspace); store().setSelected(null); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось удалить plugin') } }
  async function deleteEdges(ids: string[]) { try { let workspace = store().workspace; for (const id of ids) { const link = workspace?.graph.links.find((item) => item.id === id); if (workspace && link) workspace = await api.deletePluginLink(link.caller, link.id, true) }; store().setWorkspace(workspace); store().setSelected(null); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось удалить связь') } }

  async function persistNodePosition(id: string, position: LayoutPoint) { const layout = { ...store().layout, [id]: position }; store().setLayout(layout); try { const state = await api.readWorkspaceState(); await api.writeWorkspaceState({ ...state, layoutJson: JSON.stringify({ schemaVersion: 'workspace/v2', nodes: layout }) }) } catch (reason: unknown) { fail(reason, 'Не удалось сохранить расположение canvas') } }
  async function persistWorkspace() { const state = store(); const project = state.workspace?.project; if (!project || !state.stateHydrated) return; try { const current = await api.readWorkspaceState(); await api.writeWorkspaceState({ ...current, projectId: project.id, layoutJson: JSON.stringify({ schemaVersion: 'workspace/v2', nodes: state.layout }), tabsJson: JSON.stringify(workspaceSnapshot(state)), filtersJson: '{}' }) } catch { /* best effort, never block the editor */ } }
  async function setLocale(locale: Locale) { store().setLocaleState(locale); try { await api.saveClientLocale(locale) } catch (reason: unknown) { fail(reason, 'Не удалось сохранить язык') } }
  async function setTheme(theme: ThemePreference) { store().setThemeState(theme); try { await api.saveClientPreferences(theme) } catch (reason: unknown) { fail(reason, 'Не удалось сохранить тему') } }
  async function loadDiagnostics() { try { store().setDiagnostics(await api.diagnostics()) } catch { store().setDiagnostics([]) } }
  async function loadTraffic() { try { store().setTraffic(await api.trafficRecords()) } catch { store().setTraffic([]) } }
  async function listArtifacts(): Promise<ArtifactReference[]> { try { return await api.listRuntimeArtifacts() } catch (reason: unknown) { fail(reason, 'Не удалось получить список бинарников'); return [] } }
  async function registerArtifact(id: string, version: string, platform: string, path: string): Promise<ArtifactReference | null> { try { const artifact = await api.registerRuntimeArtifact(id, version, platform, path); store().setError(null); return artifact } catch (reason: unknown) { fail(reason, 'Не удалось зарегистрировать бинарник'); return null } }
  async function trustArtifact(id: string, version: string, platform: string, digest: string): Promise<ArtifactReference | null> { try { const artifact = await api.trustRuntimeArtifact(id, version, platform, digest); store().setError(null); return artifact } catch (reason: unknown) { fail(reason, 'Не удалось подтвердить доверие к бинарнику'); return null } }
  async function pluginMetadata(pluginID: string, view: 'manifest' | 'schema' | 'status'): Promise<string | null> { try { const value = await api.readRuntimePluginMetadata(pluginID, view); store().setRuntimeOutput(value); store().setDock('runtime'); return value } catch (reason: unknown) { fail(reason, `Не удалось получить ${view} через Core`); return null } }
  async function runtimeCommand(command: 'runtime.restart' | 'runtime.logs' | 'runtime.inspect', serviceID: string) { try { await api.runStudioRuntimeCommand(command, serviceID); store().setDock('runtime'); store().setError(null) } catch (reason: unknown) { fail(reason, `Не удалось выполнить ${command} для ${serviceID}`) } }
  return { api, refresh, refreshGraph, refreshRuntimeStatuses, openProject, createProject, openFile, saveDocument, run, runtimeCommand, initializeGit, addPlugin, createLink, deleteNodes, deleteEdges, persistNodePosition, persistWorkspace, setLocale, setTheme, loadDiagnostics, loadTraffic, listArtifacts, registerArtifact, trustArtifact, pluginMetadata }
}
