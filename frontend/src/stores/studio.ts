import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'
import type { CLIEvent, Diagnostic, RuntimeReplicaStatus, RuntimeServiceReadiness, ThemePreference, ToolchainStatus, TrafficRecordView, Workspace } from '../api/types'
import { initialWorkspaceTabs, updateCLIStreamState, type CLIStreamState, type Layout, type Locale, type ProjectList, type Selection, type TabKind, type WorkspaceApplyRecoveryOperationId, type WorkspaceApplyRecoveryStatus, type WorkspaceTab, type WorkspaceView } from '../models/studio'
import type { ServiceConfigurationUI } from '../models/serviceConfigurationUI'
import { cloneConfigurationObject, configurationDraftKey, configurationJSONDocumentPatch, configurationPathEditable, configurationPathIsJSONDocument, configurationValuesEqual, isConfigurationMapOperationPath, isConfigurationPatchEmpty, isProtectedConfigurationArrayFieldPath, isProtectedConfigurationArrayPath, mergeConfiguration, updateConfigurationMapOperationPatch, updateConfigurationPatch, updateProtectedConfigurationArrayFieldPatch, updateProtectedConfigurationArrayOperationPatch, type ConfigurationDraftIdentity, type ConfigurationObject } from '../models/configurationDraft'
import { configurationArrayOperations } from '../models/configurationArray'
import { configurationMapOperations, configurationMapOperationsKey, isConfigurationMapOperationRequest } from '../models/configurationMap'
import { latestStudioPluginSurfaces } from '../models/studioPluginPackage'

const configurationHistoryEntryLimit = 50
const configurationHistoryByteLimit = 2_097_152
const configurationHistoryCoalesceMs = 900

function emptyConfigurationDraftHistory(): ConfigurationDraftHistory {
  return { undo: [], redo: [], coalesceKey: '', coalesceAt: 0 }
}

function canChangeConfigurationHistory(draft: ServiceSettingsDraft | undefined): draft is ServiceSettingsDraft {
  return Boolean(draft?.schema && draft.status !== 'loading' && draft.status !== 'saving' && draft.status !== 'conflict' &&
    !draft.refreshingContract && draft.configurationContractState !== 'mismatch')
}

function appendConfigurationHistory(history: ConfigurationObject[], snapshot: ConfigurationObject): ConfigurationObject[] {
  const serialized = JSON.stringify(snapshot)
  if (serialized.length > configurationHistoryByteLimit) return []
  const next = [...history, cloneConfigurationObject(snapshot)]
  let totalBytes = next.reduce((total, entry) => total + JSON.stringify(entry).length, 0)
  while (next.length > configurationHistoryEntryLimit || totalBytes > configurationHistoryByteLimit) {
    const removed = next.shift()
    if (removed) totalBytes -= JSON.stringify(removed).length
  }
  return next
}

function recordConfigurationDraftEdit(
  history: ConfigurationDraftHistory,
  previousPatch: ConfigurationObject,
  actionKey: string,
): ConfigurationDraftHistory {
  const now = Date.now()
  const coalesce = actionKey !== '' && history.coalesceKey === actionKey && now - history.coalesceAt <= configurationHistoryCoalesceMs
  return {
    undo: coalesce ? history.undo : appendConfigurationHistory(history.undo, previousPatch),
    redo: [],
    coalesceKey: actionKey,
    coalesceAt: actionKey ? now : 0,
  }
}

export type StudioPluginSurface = { studioPluginId: string; version: string; id: string; title: string; route: string; context: 'workspace' | 'service'; permissions?: string[]; grantedPermissions?: string[] }

function reconcileStudioPluginTabs(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  surfaces: StudioPluginSurface[],
): { tabs: WorkspaceTab[]; activeTabId: string | null } {
  const currentSurfaces = latestStudioPluginSurfaces(surfaces)
  const surfaceByKey = new Map(currentSurfaces.map((surface) => [`${surface.studioPluginId}:${surface.id}`, surface]))
  const surfacesByPlugin = new Map<string, StudioPluginSurface[]>()
  for (const surface of currentSurfaces) {
    const grouped = surfacesByPlugin.get(surface.studioPluginId) ?? []
    grouped.push(surface)
    surfacesByPlugin.set(surface.studioPluginId, grouped)
  }
  const nextTabs: WorkspaceTab[] = []
  const tabIndexByID = new Map<string, number>()
  let nextActiveTabId = activeTabId
  for (const tab of tabs) {
    if (tab.kind !== 'studio-plugin') { nextTabs.push(tab); continue }
    const candidates = tab.studioPluginId ? surfacesByPlugin.get(tab.studioPluginId) ?? [] : []
    const current = tab.studioPluginId && tab.surfaceId
      ? surfaceByKey.get(`${tab.studioPluginId}:${tab.surfaceId}`) ?? (candidates.length === 1 ? candidates[0] : undefined)
      : undefined
    if (!current) {
      if (tab.id === activeTabId) nextActiveTabId = null
      continue
    }
    const scopedServiceId = current.context === 'service' ? tab.serviceId : undefined
    const next: WorkspaceTab = {
      ...tab,
      id: `studio-plugin:${current.studioPluginId}:${current.version}:${current.id}${scopedServiceId ? `:${scopedServiceId}` : ''}`,
      title: current.title,
      studioPluginId: current.studioPluginId,
      studioPluginVersion: current.version,
      surfaceId: current.id,
      route: current.route,
      context: current.context,
    }
    const existingIndex = tabIndexByID.get(next.id)
    if (existingIndex === undefined) {
      tabIndexByID.set(next.id, nextTabs.length)
      nextTabs.push(next)
    } else if (tab.id === activeTabId) {
      nextTabs[existingIndex] = next
    }
    if (tab.id === activeTabId) nextActiveTabId = next.id
  }
  if (!nextTabs.length) nextTabs.push(...initialWorkspaceTabs())
  if (!nextActiveTabId || !nextTabs.some((tab) => tab.id === nextActiveTabId)) {
    nextActiveTabId = nextTabs.find((tab) => tab.id === 'canvas')?.id ?? nextTabs[0].id
  }
  return { tabs: nextTabs, activeTabId: nextActiveTabId }
}

export type ConfigurationContractState = 'pending' | 'matched' | 'mismatch' | 'unavailable'
export type ConfigurationContractMismatchKind = 'schema' | 'provenance'
export type ConfigurationDraftHistory = {
  undo: ConfigurationObject[]
  redo: ConfigurationObject[]
  coalesceKey: string
  coalesceAt: number
}
export type ServiceSettingsDraft = ConfigurationDraftIdentity & {
  key: string
  schema: ConfigurationObject | null
  configurationUI: ServiceConfigurationUI | null
  configurationContractState: ConfigurationContractState
  configurationContractMismatchKind: ConfigurationContractMismatchKind | null
  configurationContractDifferences: string[]
  refreshingContract: boolean
  base: ConfigurationObject
  patch: ConfigurationObject
  history: ConfigurationDraftHistory
  baseDigest: string
  status: 'loading' | 'clean' | 'dirty' | 'saving' | 'error' | 'conflict'
  error: string | null
  revision: number
}

export type StudioState = {
  locale: Locale
  theme: ThemePreference
  workspace: Workspace | null
  projects: ProjectList
  toolchain: ToolchainStatus | null
  view: WorkspaceView
  tabs: WorkspaceTab[]
  activeTabId: string | null
  studioPluginSurfaces: StudioPluginSurface[]
  busy: boolean
  initialized: boolean
  error: string | null
  query: string
  selected: Selection
  cliEvents: CLIEvent[]
  cliStreamState: CLIStreamState
  diagnostics: Diagnostic[]
  traffic: TrafficRecordView[]
  commandOpen: boolean
  commandQuery: string
  createOpen: boolean
  serviceOpen: boolean
  projectID: string
  projectName: string
  serviceID: string
  serviceName: string
  target: string
  profile: string
  stateHydrated: boolean
  applyRecoveryStatus: WorkspaceApplyRecoveryStatus
  applyRecoveryOperationId: WorkspaceApplyRecoveryOperationId
  layout: Layout
  canvasNodes: Node[]
  canvasEdges: Edge[]
  runtimeOutput: string
  runtimeStatuses: Record<string, RuntimeServiceReadiness>
  runtimeReplicas: Record<string, RuntimeReplicaStatus[]>
  serviceSettingsDrafts: Record<string, ServiceSettingsDraft | undefined>
  setLocaleState: (locale: Locale) => void
  setThemeState: (theme: ThemePreference) => void
  setWorkspace: (workspace: Workspace | null) => void
  setProjects: (projects: ProjectList) => void
  setToolchain: (toolchain: ToolchainStatus | null) => void
  setView: (view: WorkspaceView) => void
  setTabs: (tabs: WorkspaceTab[], activeTabId: string | null) => void
  setStudioPluginSurfaces: (surfaces: StudioPluginSurface[]) => void
  setBusy: (busy: boolean) => void
  setInitialized: (initialized: boolean) => void
  setError: (error: string | null) => void
  setDiagnostics: (diagnostics: Diagnostic[]) => void
  setTraffic: (traffic: TrafficRecordView[]) => void
  setStateHydrated: (hydrated: boolean) => void
  setApplyRecovery: (status: WorkspaceApplyRecoveryStatus, operationId: WorkspaceApplyRecoveryOperationId) => void
  setLayout: (layout: Layout) => void
  setCanvasNodes: (nodes: Node[]) => void
  setCanvasEdges: (edges: Edge[]) => void
  setRuntimeOutput: (output: string) => void
  setRuntimeStatuses: (statuses: Record<string, RuntimeServiceReadiness>) => void
  setRuntimeReplicas: (replicas: Record<string, RuntimeReplicaStatus[]>) => void
  beginServiceSettingsDraft: (identity: ConfigurationDraftIdentity) => { key: string; shouldLoad: boolean }
  hydrateServiceSettingsDraft: (key: string, schema: ConfigurationObject, base: ConfigurationObject, baseDigest: string, patch?: ConfigurationObject, conflict?: boolean, configurationUI?: ServiceConfigurationUI | null) => void
  setConfigurationContractState: (key: string, state: ConfigurationContractState, differences?: string[], mismatchKind?: ConfigurationContractMismatchKind | null) => void
  beginServiceSettingsContractRefresh: (key: string) => boolean
  endServiceSettingsContractRefresh: (key: string) => void
  setServiceConfigurationUI: (key: string, configurationUI: ServiceConfigurationUI | null) => void
  failServiceSettingsDraftLoad: (key: string, error: string) => void
  setServiceSettingsDraftError: (key: string, error: string) => void
  updateServiceSettingsDraft: (key: string, path: string[], value: unknown) => void
  undoServiceSettingsDraft: (key: string) => void
  redoServiceSettingsDraft: (key: string) => void
  beginServiceSettingsDraftSave: (key: string) => number | null
  completeServiceSettingsDraftSave: (key: string, revision: number, base: ConfigurationObject, baseDigest: string) => void
  failServiceSettingsDraftSave: (key: string, revision: number, error: string, conflict?: boolean) => void
  refreshServiceSettingsDraftConflict: (key: string, base: ConfigurationObject, baseDigest: string, error: string) => void
  discardServiceSettingsDraft: (key: string) => void
  removeServiceSettingsDraft: (key: string) => void
  closeTab: (id: string) => void
  reorderTabs: (fromID: string, toID: string) => void
  navigate: (tab: TabKind) => void
  openStudioPluginSurface: (surface: StudioPluginSurface, context?: { projectId?: string; serviceId?: string }) => void
  pushCLIEvent: (event: CLIEvent) => void
  setField: (field: 'projectID' | 'projectName' | 'serviceID' | 'serviceName' | 'query' | 'commandQuery' | 'target' | 'profile', value: string) => void
  setCommandOpen: (open: boolean) => void
  setCreateOpen: (open: boolean) => void
  setServiceOpen: (open: boolean) => void
  setActiveTab: (id: string) => void
  setSelected: (selection: Selection) => void
}

export const useStudioStore = create<StudioState>((set, get) => ({
  locale: 'ru', theme: 'system', workspace: null, projects: [], toolchain: null, view: 'home', tabs: initialWorkspaceTabs(), activeTabId: 'canvas', studioPluginSurfaces: [], busy: true, initialized: false, error: null, query: '', selected: null, cliEvents: [], cliStreamState: 'idle', diagnostics: [], traffic: [], commandOpen: false, commandQuery: '', createOpen: false, serviceOpen: false, projectID: '', projectName: '', serviceID: '', serviceName: '', target: 'local', profile: '', stateHydrated: false, applyRecoveryStatus: 'none', applyRecoveryOperationId: null, layout: {}, canvasNodes: [], canvasEdges: [], runtimeOutput: '', runtimeStatuses: {}, runtimeReplicas: {}, serviceSettingsDrafts: {},
  setLocaleState: (locale) => { set({ locale }) },
  setThemeState: (theme) => { set({ theme }) },
  setWorkspace: (workspace) => { set({ workspace }) },
  setProjects: (projects) => { set({ projects }) },
  setToolchain: (toolchain) => { set({ toolchain }) },
  setView: (view) => { set({ view }) },
  setTabs: (tabs, activeTabId) => { set((state) => state.studioPluginSurfaces.length ? { ...reconcileStudioPluginTabs(tabs, activeTabId, state.studioPluginSurfaces) } : { tabs, activeTabId }) },
  setStudioPluginSurfaces: (studioPluginSurfaces) => { set((state) => ({ studioPluginSurfaces, ...reconcileStudioPluginTabs(state.tabs, state.activeTabId, studioPluginSurfaces) })) },
  setBusy: (busy) => { set({ busy }) },
  setInitialized: (initialized) => { set({ initialized }) },
  setError: (error) => { set({ error }) },
  setDiagnostics: (diagnostics) => { set({ diagnostics }) },
  setTraffic: (traffic) => { set({ traffic }) },
  setStateHydrated: (stateHydrated) => { set({ stateHydrated }) },
  setApplyRecovery: (applyRecoveryStatus, applyRecoveryOperationId) => { set({ applyRecoveryStatus, applyRecoveryOperationId }) },
  setLayout: (layout) => { set({ layout }) },
  setCanvasNodes: (canvasNodes) => { set({ canvasNodes }) },
  setCanvasEdges: (canvasEdges) => { set({ canvasEdges }) },
  setRuntimeOutput: (runtimeOutput) => { set({ runtimeOutput }) },
  setRuntimeStatuses: (runtimeStatuses) => { set({ runtimeStatuses }) },
  setRuntimeReplicas: (runtimeReplicas) => { set({ runtimeReplicas }) },
  beginServiceSettingsDraft: (identity) => {
    const key = configurationDraftKey(identity.projectRoot, identity.serviceId)
    let shouldLoad = false
    set((state) => {
      const existing = state.serviceSettingsDrafts[key]
      if (existing && existing.settingsPath === identity.settingsPath && existing.schemaPath === identity.schemaPath) {
        if (existing.status !== 'error' || existing.schema !== null) return {}
        shouldLoad = true
        return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...existing, status: 'loading', error: null } } }
      }
      shouldLoad = true
      return {
        serviceSettingsDrafts: {
          ...state.serviceSettingsDrafts,
          [key]: { ...identity, key, schema: null, configurationUI: null, configurationContractState: 'pending', configurationContractMismatchKind: null, configurationContractDifferences: [], refreshingContract: false, base: {}, patch: {}, history: emptyConfigurationDraftHistory(), baseDigest: '', status: 'loading', error: null, revision: 0 },
        },
      }
    })
    return { key, shouldLoad }
  },
  hydrateServiceSettingsDraft: (key, schema, base, baseDigest, patch = {}, conflict = false, configurationUI = null) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft || draft.status !== 'loading') return {}
    const safePatch = cloneConfigurationObject(patch)
    const status = conflict ? 'conflict' : isConfigurationPatchEmpty(safePatch) ? 'clean' : 'dirty'
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, schema: cloneConfigurationObject(schema), configurationUI, base: cloneConfigurationObject(base), baseDigest, patch: safePatch, history: emptyConfigurationDraftHistory(), status, error: conflict ? 'Project settings changed after this draft was saved' : null, revision: draft.revision + 1 } } }
  }) },
  setConfigurationContractState: (key, configurationContractState, configurationContractDifferences = [], configurationContractMismatchKind = null) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft?.schema) return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: {
      ...draft,
      configurationContractState,
      configurationContractMismatchKind: configurationContractState === 'mismatch' ? configurationContractMismatchKind : null,
      configurationContractDifferences: configurationContractState === 'mismatch' ? configurationContractDifferences.slice(0, 24) : [],
      ...(configurationContractState === 'matched' ? {} : { configurationUI: null }),
    } } }
  }) },
  beginServiceSettingsContractRefresh: (key) => {
    let began = false
    set((state) => {
      const draft = state.serviceSettingsDrafts[key]
      if (!draft?.schema || draft.status === 'loading' || draft.status === 'saving' || draft.refreshingContract) return {}
      began = true
      return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, refreshingContract: true } } }
    })
    return began
  },
  endServiceSettingsContractRefresh: (key) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft?.refreshingContract) return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, refreshingContract: false } } }
  }) },
  setServiceConfigurationUI: (key, configurationUI) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft?.schema || draft.configurationContractState !== 'matched') return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, configurationUI } } }
  }) },
  failServiceSettingsDraftLoad: (key, error) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft || draft.status !== 'loading') return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, status: 'error', error } } }
  }) },
  setServiceSettingsDraftError: (key, error) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft?.schema || draft.status === 'loading' || draft.status === 'saving' || draft.status === 'conflict') return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, status: 'error', error } } }
  }) },
  updateServiceSettingsDraft: (key, path, value) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft?.schema || draft.status === 'loading' || draft.status === 'saving' || draft.status === 'conflict' || draft.refreshingContract) return {}
    if (draft.configurationContractState === 'mismatch') throw new Error('Live service schema differs from the Project schema')
    const mapOperationRequest = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, configurationMapOperationsKey)
    const mapOperations = configurationMapOperations(value)
    if (mapOperationRequest && (!isConfigurationMapOperationRequest(value) || !mapOperations)) throw new Error('Configuration map operation request is invalid')
    const operations = configurationArrayOperations(value)
    let patch: ConfigurationObject
    if (mapOperations) {
      if (!isConfigurationMapOperationPath(draft.base, draft.patch, draft.schema, path)) throw new Error('Map operations are only supported for typed unprotected maps')
      patch = draft.patch
      for (const operation of mapOperations) patch = updateConfigurationMapOperationPatch(draft.base, patch, draft.schema, path, operation)
    } else if (operations) {
      if (!isProtectedConfigurationArrayPath(draft.base, draft.patch, draft.schema, path)) throw new Error('Array operations are only supported for protected arrays')
      patch = draft.patch
      for (const operation of operations) patch = updateProtectedConfigurationArrayOperationPatch(draft.base, patch, draft.schema, path, operation)
    } else {
      if (!configurationPathEditable(draft.schema, path, value)) throw new Error('Settings path is unknown, read-only, or sensitive')
      const projected = mergeConfiguration(draft.base, draft.patch)
      const patchValue = configurationPathIsJSONDocument(draft.schema, path, projected) ? configurationJSONDocumentPatch(value) : value
      patch = isProtectedConfigurationArrayFieldPath(draft.base, draft.patch, draft.schema, path)
        ? updateProtectedConfigurationArrayFieldPatch(draft.base, draft.patch, draft.schema, path, patchValue)
        : updateConfigurationPatch(draft.base, draft.patch, path, patchValue)
    }
    if (configurationValuesEqual(draft.patch, patch)) return {}
    const actionKey = operations || mapOperations ? '' : JSON.stringify(path)
    const history = recordConfigurationDraftEdit(draft.history, draft.patch, actionKey)
    const status = isConfigurationPatchEmpty(patch) ? 'clean' : 'dirty'
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, patch, history, status, error: null, revision: draft.revision + 1 } } }
  }) },
  undoServiceSettingsDraft: (key) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!canChangeConfigurationHistory(draft) || draft.history.undo.length === 0) return {}
    const patch = cloneConfigurationObject(draft.history.undo.at(-1) ?? {})
    const history: ConfigurationDraftHistory = {
      undo: draft.history.undo.slice(0, -1),
      redo: appendConfigurationHistory(draft.history.redo, draft.patch),
      coalesceKey: '',
      coalesceAt: 0,
    }
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: {
      ...draft, patch, history, status: isConfigurationPatchEmpty(patch) ? 'clean' : 'dirty', error: null, revision: draft.revision + 1,
    } } }
  }) },
  redoServiceSettingsDraft: (key) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!canChangeConfigurationHistory(draft) || draft.history.redo.length === 0) return {}
    const patch = cloneConfigurationObject(draft.history.redo.at(-1) ?? {})
    const history: ConfigurationDraftHistory = {
      undo: appendConfigurationHistory(draft.history.undo, draft.patch),
      redo: draft.history.redo.slice(0, -1),
      coalesceKey: '',
      coalesceAt: 0,
    }
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: {
      ...draft, patch, history, status: isConfigurationPatchEmpty(patch) ? 'clean' : 'dirty', error: null, revision: draft.revision + 1,
    } } }
  }) },
  beginServiceSettingsDraftSave: (key) => {
    let revision: number | null = null
    set((state) => {
      const draft = state.serviceSettingsDrafts[key]
      if (!draft?.schema || isConfigurationPatchEmpty(draft.patch) || draft.status === 'loading' || draft.status === 'saving' || draft.status === 'conflict') return {}
      revision = draft.revision
      return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, status: 'saving', error: null } } }
    })
    return revision
  },
  completeServiceSettingsDraftSave: (key, revision, base, baseDigest) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft || draft.status !== 'saving') return {}
    if (draft.revision !== revision) return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, status: 'conflict', error: 'Draft changed while the save was in progress' } } }
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, base: cloneConfigurationObject(base), baseDigest, patch: {}, history: emptyConfigurationDraftHistory(), status: 'clean', error: null, revision: draft.revision + 1 } } }
  }) },
  failServiceSettingsDraftSave: (key, revision, error, conflict = false) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft || draft.status !== 'saving' || draft.revision !== revision) return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, status: conflict ? 'conflict' : 'error', error } } }
  }) },
  refreshServiceSettingsDraftConflict: (key, base, baseDigest, error) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft || draft.status !== 'conflict') return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, base: cloneConfigurationObject(base), baseDigest, history: { ...draft.history, coalesceKey: '', coalesceAt: 0 }, error, revision: draft.revision + 1 } } }
  }) },
  discardServiceSettingsDraft: (key) => { set((state) => {
    const draft = state.serviceSettingsDrafts[key]
    if (!draft?.schema || draft.status === 'loading' || draft.status === 'saving') return {}
    return { serviceSettingsDrafts: { ...state.serviceSettingsDrafts, [key]: { ...draft, patch: {}, history: emptyConfigurationDraftHistory(), status: 'clean', error: null, revision: draft.revision + 1 } } }
  }) },
  removeServiceSettingsDraft: (key) => { set((state) => {
    if (!state.serviceSettingsDrafts[key]) return {}
    const serviceSettingsDrafts = Object.fromEntries(Object.entries(state.serviceSettingsDrafts).filter(([draftKey]) => draftKey !== key)) as StudioState['serviceSettingsDrafts']
    return { serviceSettingsDrafts }
  }) },
  closeTab: (id) => { set((state) => {
    const index = state.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return {}
    const tabs = state.tabs.filter((tab) => tab.id !== id)
    const activeTabId = state.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.activeTabId
    return { tabs, activeTabId }
  }) },
  reorderTabs: (fromID, toID) => { set((state) => {
    const from = state.tabs.findIndex((tab) => tab.id === fromID)
    const to = state.tabs.findIndex((tab) => tab.id === toID)
    if (from < 0 || to < 0 || from === to) return {}
    const tabs = [...state.tabs]
    const [moved] = tabs.splice(from, 1)
    tabs.splice(to, 0, moved)
    return { tabs }
  }) },
  navigate: (kind) => { set((state) => {
    const current = state.tabs.find((tab) => tab.kind === kind && kind !== 'studio-plugin')
    if (current) return { activeTabId: current.id, view: 'workspace' }
    const tab: WorkspaceTab = { id: kind, kind, title: tabTitle(kind) }
    return { tabs: [...state.tabs, tab], activeTabId: tab.id, view: 'workspace' }
  }) },
  openStudioPluginSurface: (surface, context) => { set((state) => {
    const serviceId = context?.serviceId
    if (surface.context === 'service' && !serviceId || surface.context === 'workspace' && serviceId) return state
    const id = `studio-plugin:${surface.studioPluginId}:${surface.version}:${surface.id}${surface.context === 'service' ? `:${serviceId ?? ''}` : ''}`
    const tab: WorkspaceTab = { id, kind: 'studio-plugin', title: surface.title, studioPluginId: surface.studioPluginId, studioPluginVersion: surface.version, surfaceId: surface.id, route: surface.route, context: surface.context, ...(context?.projectId ? { projectId: context.projectId } : {}), ...(context?.serviceId ? { serviceId: context.serviceId } : {}) }
    const existingIndex = state.tabs.findIndex((current) => current.id === id)
    const tabs = existingIndex < 0 ? [...state.tabs, tab] : state.tabs.map((current, index) => index === existingIndex ? tab : current)
    return { tabs, activeTabId: id, view: 'workspace' }
  }) },
  pushCLIEvent: (event) => { set((state) => ({ cliEvents: [...state.cliEvents.slice(-99), event], cliStreamState: updateCLIStreamState(state.cliStreamState, event) })) },
  setField: (field, value) => { set({ [field]: value } as Pick<StudioState, typeof field>) },
  setCommandOpen: (commandOpen) => { set({ commandOpen, commandQuery: commandOpen ? get().commandQuery : '' }) },
  setCreateOpen: (createOpen) => { set({ createOpen }) },
  setServiceOpen: (serviceOpen) => { set({ serviceOpen }) },
  setActiveTab: (activeTabId) => { if (get().tabs.some((tab) => tab.id === activeTabId)) set({ activeTabId, view: 'workspace' }) },
  setSelected: (selected) => { set({ selected }) },
}))

function tabTitle(kind: TabKind): string {
  const titles: Record<TabKind, string> = { canvas: 'Canvas', git: 'Git', reports: 'Reports', 'studio-plugins': 'Studio plugins', problems: 'Problems', output: 'Output', 'studio-plugin': 'Plugin' }
  return titles[kind]
}
