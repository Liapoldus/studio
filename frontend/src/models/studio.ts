import type { Edge, Node } from '@xyflow/react'
import type { CLIEvent, StudioAPI } from '../api/types'

export type Locale = 'ru' | 'en'
export type NavItem = 'home' | 'graph' | 'files' | 'git' | 'reports' | 'plugins' | 'artifacts' | 'runtime' | 'settings'
export type DockPanel = 'problems' | 'cli' | 'git' | 'reports' | 'tools' | 'runtime'
export type DocumentKind = 'canvas' | 'file'
export type Document = { id: string; kind: DocumentKind; title: string; path?: string; content?: string; dirty?: boolean }
export type Selection = { kind: 'plugin' | 'link'; id: string } | null
export type LayoutPoint = { x: number; y: number }
export type Layout = Record<string, LayoutPoint>
export type ProjectList = Awaited<ReturnType<StudioAPI['listProjects']>>
export type CanvasNode = Node
export type CanvasEdge = Edge

export type WorkspaceSnapshot = {
  schemaVersion: 'workspace/v2'
  activeNav: NavItem
  activeDocument: string
  dock: DockPanel | null
  tabs: Array<{ id: string; kind: DocumentKind; title: string; path?: string }>
}

export const emptyDocuments = (): Document[] => [{ id: 'canvas', kind: 'canvas', title: 'Canvas' }]

export function messageOf(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  return fallback
}

export function summarizeCLIEvent(event: CLIEvent, maxLength = 600): string {
  let detail = event.message ?? event.phase ?? event.state ?? ''
  if (!detail && event.payload !== undefined) {
    try { detail = JSON.stringify(event.payload) } catch { detail = '[payload unavailable]' }
  }
  return detail.length > maxLength ? `${detail.slice(0, maxLength)}…` : detail
}

export function parseLayout(value: string | undefined): Layout {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as { nodes?: Record<string, { x?: unknown; y?: unknown }> }
    const layout: Layout = {}
    for (const [id, point] of Object.entries(parsed.nodes ?? {})) {
      if (typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)) layout[id] = { x: point.x, y: point.y }
    }
    return layout
  } catch { return {} }
}

const workspaceScreens: NavItem[] = ['graph', 'files', 'git', 'reports', 'plugins', 'artifacts', 'runtime', 'settings']

function isWorkspaceScreen(value: unknown): value is Exclude<NavItem, 'home'> {
  return typeof value === 'string' && workspaceScreens.includes(value as Exclude<NavItem, 'home'>)
}

export function workspaceSnapshot(state: Pick<WorkspaceSnapshotState, 'screen' | 'activeDocument' | 'dock' | 'documents'>): WorkspaceSnapshot {
  return { schemaVersion: 'workspace/v2', activeNav: state.screen, activeDocument: state.activeDocument, dock: state.dock, tabs: state.documents.map(({ id, kind, title, path }) => ({ id, kind, title, path })) }
}

export type WorkspaceSnapshotState = Pick<WorkspaceSnapshot, 'activeDocument' | 'dock'> & { screen: NavItem; documents: Document[] }

export async function restoreWorkspaceState(api: StudioAPI): Promise<{ documents: Document[]; activeDocument: string; screen: NavItem; dock: DockPanel | null; layout: Layout }> {
  const fallback = { documents: emptyDocuments(), activeDocument: 'canvas', screen: 'graph' as NavItem, dock: null as DockPanel | null, layout: {} }
  try {
    const saved = await api.readWorkspaceState()
    const snapshot = JSON.parse(saved.tabsJson) as Partial<WorkspaceSnapshot>
    if (snapshot.schemaVersion !== 'workspace/v2') return fallback
    const tabs = Array.isArray(snapshot.tabs) && snapshot.tabs.length > 0 ? snapshot.tabs : fallback.documents
    const documents = await Promise.all(tabs.map(async (tab): Promise<Document | null> => {
      if (tab.kind !== 'file' || !tab.path) return { ...tab }
      try { return { ...tab, content: new TextDecoder().decode(await api.readProjectFile(tab.path)), dirty: false } } catch { return null }
    }))
    const usable = documents.filter((document): document is Document => document !== null)
    return { documents: usable.length > 0 ? usable : fallback.documents, activeDocument: typeof snapshot.activeDocument === 'string' && usable.some((document) => document.id === snapshot.activeDocument) ? snapshot.activeDocument : 'canvas', screen: isWorkspaceScreen(snapshot.activeNav) ? snapshot.activeNav : fallback.screen, dock: snapshot.dock ?? null, layout: parseLayout(saved.layoutJson) }
  } catch { return fallback }
}
