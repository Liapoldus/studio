import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'
import type { CLIEvent, Diagnostic, ProjectFile, RuntimePluginReadiness, ThemePreference, ToolchainStatus, TrafficRecordView, Workspace } from '../api/types'
import { emptyDocuments, type DockPanel, type Document, type Layout, type Locale, type NavItem, type ProjectList, type Selection } from '../models/studio'

export type StudioState = {
  locale: Locale
  theme: ThemePreference
  workspace: Workspace | null
  projects: ProjectList
  toolchain: ToolchainStatus | null
  screen: NavItem
  busy: boolean
  initialized: boolean
  error: string | null
  query: string
  documents: Document[]
  activeDocument: string
  selected: Selection
  dock: DockPanel | null
  cliEvents: CLIEvent[]
  diagnostics: Diagnostic[]
  traffic: TrafficRecordView[]
  commandOpen: boolean
  commandQuery: string
  createOpen: boolean
  pluginOpen: boolean
  projectID: string
  projectName: string
  pluginID: string
  pluginName: string
  target: string
  profile: string
  stateHydrated: boolean
  layout: Layout
  canvasNodes: Node[]
  canvasEdges: Edge[]
  runtimeOutput: string
  runtimeStatuses: Record<string, RuntimePluginReadiness>
  setLocaleState: (locale: Locale) => void
  setThemeState: (theme: ThemePreference) => void
  setWorkspace: (workspace: Workspace | null) => void
  setProjects: (projects: ProjectList) => void
  setToolchain: (toolchain: ToolchainStatus | null) => void
  setScreen: (screen: NavItem) => void
  setDock: (dock: DockPanel | null) => void
  setBusy: (busy: boolean) => void
  setInitialized: (initialized: boolean) => void
  setError: (error: string | null) => void
  setDiagnostics: (diagnostics: Diagnostic[]) => void
  setTraffic: (traffic: TrafficRecordView[]) => void
  setDocuments: (documents: Document[]) => void
  setStateHydrated: (hydrated: boolean) => void
  setLayout: (layout: Layout) => void
  setCanvasNodes: (nodes: Node[]) => void
  setCanvasEdges: (edges: Edge[]) => void
  setRuntimeOutput: (output: string) => void
  setRuntimeStatuses: (statuses: Record<string, RuntimePluginReadiness>) => void
  setDocumentContent: (id: string, content: string) => void
  closeDocument: (id: string) => void
  navigate: (item: NavItem) => void
  toggleDock: (panel: DockPanel) => void
  pushCLIEvent: (event: CLIEvent) => void
  setField: (field: 'projectID' | 'projectName' | 'pluginID' | 'pluginName' | 'query' | 'commandQuery' | 'target' | 'profile', value: string) => void
  setCommandOpen: (open: boolean) => void
  setCreateOpen: (open: boolean) => void
  setPluginOpen: (open: boolean) => void
  setActiveDocument: (id: string) => void
  setSelected: (selection: Selection) => void
}

export const useStudioStore = create<StudioState>((set, get) => ({
  locale: 'ru', theme: 'system', workspace: null, projects: [], toolchain: null, screen: 'home', busy: true, initialized: false, error: null, query: '', documents: emptyDocuments(), activeDocument: 'canvas', selected: null, dock: null, cliEvents: [], diagnostics: [], traffic: [], commandOpen: false, commandQuery: '', createOpen: false, pluginOpen: false, projectID: '', projectName: '', pluginID: '', pluginName: '', target: 'local', profile: '', stateHydrated: false, layout: {}, canvasNodes: [], canvasEdges: [], runtimeOutput: '', runtimeStatuses: {},
  setLocaleState: (locale) => { set({ locale }); }, setThemeState: (theme) => { set({ theme }); }, setWorkspace: (workspace) => { set({ workspace }); }, setProjects: (projects) => { set({ projects }); }, setToolchain: (toolchain) => { set({ toolchain }); }, setScreen: (screen) => { set({ screen }); }, setDock: (dock) => { set({ dock }); }, setBusy: (busy) => { set({ busy }); }, setInitialized: (initialized) => { set({ initialized }); }, setError: (error) => { set({ error }); }, setDiagnostics: (diagnostics) => { set({ diagnostics }); }, setTraffic: (traffic) => { set({ traffic }); }, setDocuments: (documents) => { set({ documents }); }, setStateHydrated: (stateHydrated) => { set({ stateHydrated }); }, setLayout: (layout) => { set({ layout }); }, setCanvasNodes: (canvasNodes) => { set({ canvasNodes }); }, setCanvasEdges: (canvasEdges) => { set({ canvasEdges }); }, setRuntimeOutput: (runtimeOutput) => { set({ runtimeOutput }); }, setRuntimeStatuses: (runtimeStatuses) => { set({ runtimeStatuses }); },
  setDocumentContent: (id, content) => { set((state) => ({ documents: state.documents.map((document) => document.id === id ? { ...document, content, dirty: true } : document) })); },
  closeDocument: (id) => { set((state) => { const documents = state.documents.filter((document) => document.id !== id); const next = documents.length > 0 ? documents : emptyDocuments(); return { documents: next, activeDocument: state.activeDocument === id ? (next[next.length - 1]?.id ?? 'canvas') : state.activeDocument } }); },
  navigate: (screen) => { set((state) => { const hasCanvas = state.documents.some((document) => document.id === 'canvas'); return { screen, documents: screen === 'graph' && !hasCanvas ? [...state.documents, ...emptyDocuments()] : state.documents, activeDocument: screen === 'graph' && !hasCanvas ? 'canvas' : state.activeDocument } }); },
  toggleDock: (dock) => { set((state) => ({ dock: state.dock === dock ? null : dock })); },
  pushCLIEvent: (event) => { set((state) => ({ cliEvents: [...state.cliEvents.slice(-99), event] })); },
  setField: (field, value) => { set({ [field]: value } as Pick<StudioState, typeof field>); },
  setCommandOpen: (commandOpen) => { set({ commandOpen, commandQuery: commandOpen ? get().commandQuery : '' }); },
  setCreateOpen: (createOpen) => { set({ createOpen }); }, setPluginOpen: (pluginOpen) => { set({ pluginOpen }); }, setActiveDocument: (activeDocument) => { set({ activeDocument }); }, setSelected: (selected) => { set({ selected }); },
}))

export function projectFiles(state: StudioState): ProjectFile[] { return state.workspace?.files ?? [] }
