import type { Edge, Node } from '@xyflow/react'
import type { CLIEvent, StudioAPI, WorkspaceState } from '../api/types'

export type Locale = 'ru' | 'en'
export type CLIStreamState = 'idle' | 'running' | 'cancelling'
export type WorkspaceView = 'home' | 'settings' | 'workspace'
export type TabKind = 'canvas' | 'git' | 'reports' | 'problems' | 'output' | 'studio-plugin'
export type WorkspaceTab = {
  id: string
  kind: TabKind
  title: string
  studioPluginId?: string
  studioPluginVersion?: string
  surfaceId?: string
  route?: string
  context?: 'workspace' | 'service'
  projectId?: string
  serviceId?: string
}
export type Selection = { kind: 'service' | 'link'; id: string } | null
export type LayoutPoint = { x: number; y: number }
export type Layout = Record<string, LayoutPoint>
export type ProjectList = Awaited<ReturnType<StudioAPI['listProjects']>>
export type CanvasNode = Node
export type CanvasEdge = Edge
export type WorkspaceApplyRecoveryOperationId = string | null

export type WorkspaceSnapshot = {
  schemaVersion: 'workspace/v5'
  activeTabId: string | null
  tabs: WorkspaceTab[]
  layout: Layout
}
export type WorkspaceApplyRecoveryStatus = 'none' | 'applying' | 'confirmation-required'
export type OperationReplicaOutcome = { replicaId: string; desiredGeneration: number; state: 'pending' | 'applied' | 'failed'; failureCode?: string }

export const initialWorkspaceTabs = (): WorkspaceTab[] => [{ id: 'canvas', kind: 'canvas', title: 'Canvas' }]

export function messageOf(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  if (reason && typeof reason === 'object') {
    const value = reason as Record<string, unknown>
    for (const key of ['message', 'error', 'cause']) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate
      if (candidate instanceof Error && candidate.message.trim()) return candidate.message
    }
  }
  return fallback
}

export function summarizeCLIEvent(event: CLIEvent, maxLength = 600): string {
  let detail = event.message ?? event.phase ?? event.state ?? ''
  if (!detail && event.payload !== undefined) {
    detail = summarizeRuntimeStatusOutput(event.payload) ?? ''
    if (!detail) {
      try { detail = JSON.stringify(event.payload) } catch { detail = '[payload unavailable]' }
    }
  }
  const code = typeof event.code === 'string' && /^[a-z0-9][a-z0-9_.-]{0,79}$/u.test(event.code)
    ? `${event.code}: `
    : ''
  detail = `${code}${detail}`
  return detail.length > maxLength ? `${detail.slice(0, maxLength)}…` : detail
}

export function operationReplicaOutcomes(events: CLIEvent[]): OperationReplicaOutcome[] {
  for (let index = events.length - 1; index >= 0; index--) {
    const payload = record(events[index]?.payload)
    if (!payload) continue
    let source: Record<string, unknown> = payload
    if (typeof source.text === 'string') {
      try { source = record(JSON.parse(source.text) as unknown) ?? {} } catch { continue }
    }
    if (!Array.isArray(source.replicaOutcomes) || source.replicaOutcomes.length > 128) continue
    const outcomes: OperationReplicaOutcome[] = []
    for (const item of source.replicaOutcomes) {
      const value = record(item)
      if (!value || typeof value.replicaId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(value.replicaId) ||
        typeof value.desiredGeneration !== 'number' || !Number.isSafeInteger(value.desiredGeneration) || value.desiredGeneration < 1 ||
        (value.state !== 'pending' && value.state !== 'applied' && value.state !== 'failed')) return []
      const failureCode = typeof value.failureCode === 'string' && /^[a-z0-9_]{1,64}$/u.test(value.failureCode) ? value.failureCode : undefined
      outcomes.push({ replicaId: value.replicaId, desiredGeneration: value.desiredGeneration, state: value.state, ...(failureCode ? { failureCode } : {}) })
    }
    return outcomes
  }
  return []
}

function summarizeRuntimeStatusOutput(payload: unknown): string | null {
  const wrapped = record(payload)
  let value: unknown = payload
  if (typeof wrapped?.text === 'string') {
    try { value = JSON.parse(wrapped.text) as unknown } catch { return null }
  }
  const status = record(value)
  if (status?.type !== 'runtime.status' || !Array.isArray(status.containers) || status.containers.length > 32) return null
  const containers = status.containers.flatMap((item) => {
    const container = record(item)
    const name = typeof container?.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(container.name) ? container.name : null
    const state = typeof container?.state === 'string' && /^(created|running|restarting|paused|exited|dead|removing|unknown)$/u.test(container.state) ? container.state : null
    if (!name || !state) return []
    const health = typeof container?.health === 'string' && /^(healthy|unhealthy|starting|none)$/u.test(container.health) ? ` (${container.health})` : ''
    return [`${name}: ${state}${health}`]
  })
  if (containers.length === 0) return 'No runtime containers found'
  return `Containers: ${containers.join(' · ')}`
}

export function updateCLIStreamState(current: CLIStreamState, event: CLIEvent): CLIStreamState {
  if (event.type === 'run.started') return 'running'
  if (event.type === 'run.cancel_requested') return 'cancelling'
  if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') return 'idle'
  return current
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseLayout(value: unknown): Layout {
  const source = typeof value === 'string' ? (() => { try { return JSON.parse(value) as unknown } catch { return null } })() : value
  const root = record(source)
  const nodes = record(root?.nodes) ?? root
  const layout: Layout = {}
  for (const [id, rawPoint] of Object.entries(nodes ?? {})) {
    const point = record(rawPoint)
    if (point && typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)) {
      layout[id] = { x: point.x, y: point.y }
    }
  }
  return layout
}

const tabKinds: readonly TabKind[] = ['canvas', 'git', 'reports', 'problems', 'output', 'studio-plugin']

function restoreTab(value: unknown): WorkspaceTab | null {
  const tab = record(value)
  if (!tab || typeof tab.id !== 'string' || !tab.id || typeof tab.title !== 'string' || !tabKinds.includes(tab.kind as TabKind)) return null
  if (tab.kind !== 'studio-plugin') {
    if (tab.id !== tab.kind) return null
    return { id: tab.id, kind: tab.kind as TabKind, title: tab.title }
  }
  if (typeof tab.studioPluginId !== 'string' || typeof tab.studioPluginVersion !== 'string' || typeof tab.surfaceId !== 'string' || typeof tab.route !== 'string') return null
  if (!tab.route || tab.route.startsWith('/') || tab.route.split(/[\\/]/u).some((part) => part === '..')) return null
  if (tab.projectId !== undefined && (typeof tab.projectId !== 'string' || !tab.projectId)) return null
  if (tab.serviceId !== undefined && (typeof tab.serviceId !== 'string' || !tab.serviceId)) return null
  return { id: tab.id, kind: 'studio-plugin', title: tab.title, studioPluginId: tab.studioPluginId, studioPluginVersion: tab.studioPluginVersion, surfaceId: tab.surfaceId, route: tab.route, ...(tab.projectId ? { projectId: tab.projectId } : {}), ...(tab.serviceId ? { serviceId: tab.serviceId } : {}) }
}

export function workspaceSnapshot(state: Pick<WorkspaceSnapshot, 'activeTabId' | 'tabs' | 'layout'>): WorkspaceSnapshot {
  return { schemaVersion: 'workspace/v5', activeTabId: state.activeTabId, tabs: state.tabs.map((tab) => ({ ...tab })), layout: { ...state.layout } }
}

// A pure preview: callers can inspect the exact before/after JSON without writes.
// Only this migration reads the old tab ID; the active UI has no alias for it.
export function previewWorkspaceMigration(tabsJson: string): { before: string; after: string; changed: boolean } {
  const source = record(JSON.parse(tabsJson) as unknown)
  if (!source || !Array.isArray(source.tabs) || !['workspace/v3', 'workspace/v4', 'workspace/v5'].includes(String(source.schemaVersion))) throw new Error('Unsupported workspace version; recover the saved state before continuing')
  const tabs = source.tabs.map((value: unknown) => {
    const tab = record(value)
    if (tab?.kind === 'studio-plugin' && source.schemaVersion !== 'workspace/v5') {
      const { pluginId, pluginVersion, ...rest } = tab
      return { ...rest, studioPluginId: pluginId, studioPluginVersion: pluginVersion }
    }
    if (tab?.kind === 'studio-plugins') return null
    return value
  })
  const retainedTabs = tabs.filter((value: unknown) => {
    const tab = record(value)
    return tab && !['files', 'artifacts', 'runtime', 'plugins', 'studio-plugins'].includes(String(tab.kind))
  })
  if (!retainedTabs.some((value: unknown) => { const tab = record(value); return tab?.id === 'canvas' && tab.kind === 'canvas' })) retainedTabs.push({ id: 'canvas', kind: 'canvas', title: 'Canvas' })
  const uniqueTabs = retainedTabs.filter((value: unknown, index: number, all: unknown[]) => {
    const current = restoreTab(value)
    return current !== null && all.findIndex((candidate) => restoreTab(candidate)?.id === current.id) === index
  })
  if (!uniqueTabs.some((value: unknown) => { const tab = record(value); return tab?.id === 'canvas' && tab.kind === 'canvas' })) uniqueTabs.push({ id: 'canvas', kind: 'canvas', title: 'Canvas' })
  const activeTabId = uniqueTabs.some((value: unknown) => restoreTab(value)?.id === source.activeTabId)
    ? source.activeTabId
    : 'canvas'
  const normalized = { ...source, schemaVersion: 'workspace/v5', tabs: uniqueTabs, activeTabId }
  const changed = JSON.stringify(normalized) !== JSON.stringify(source)
  return { before: tabsJson, after: changed ? JSON.stringify(normalized) : tabsJson, changed }
}

export function workspaceStateUpdate(saved: WorkspaceState, snapshot: WorkspaceSnapshot): WorkspaceState {
  const previous = saved.tabsJson === '[]' ? {} : record(JSON.parse(previewWorkspaceMigration(saved.tabsJson).after) as unknown) ?? {}
  const previousTabs = Array.isArray(previous.tabs) ? previous.tabs.map(record) : []
  const tabs = snapshot.tabs.map((tab) => ({ ...previousTabs.find((value) => value?.id === tab.id), ...tab }))
  const oldLayout = record(JSON.parse(saved.layoutJson) as unknown) ?? {}
  return {
    ...saved,
    tabsJson: JSON.stringify({ ...previous, ...snapshot, tabs }),
    layoutJson: JSON.stringify({ ...oldLayout, schemaVersion: 'workspace/v5', nodes: snapshot.layout }),
  }
}

export function workspaceStateWithApplyRecovery(saved: WorkspaceState, status: WorkspaceApplyRecoveryStatus, operationId: WorkspaceApplyRecoveryOperationId = null): WorkspaceState {
  const normalized = saved.tabsJson === '[]'
    ? workspaceStateUpdate(saved, workspaceSnapshot({ activeTabId: 'canvas', tabs: initialWorkspaceTabs(), layout: parseLayout(saved.layoutJson) }))
    : saved
  const previous = record(JSON.parse(previewWorkspaceMigration(normalized.tabsJson).after) as unknown)
  if (!previous) throw new Error('Unsupported workspace state; recover the saved state before changing apply recovery')
  const tabs = { ...previous }
  if (status === 'none') delete tabs.applyRecovery
  else tabs.applyRecovery = {
    schemaVersion: 'studio-apply-recovery/v2',
    state: status,
    target: 'local',
    ...(isSafeApplyOperationID(operationId) ? { operationId } : {}),
  }
  return { ...normalized, tabsJson: JSON.stringify(tabs) }
}

export function isSafeApplyOperationID(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
}

function restoredApplyRecovery(snapshot: Record<string, unknown>): { status: WorkspaceApplyRecoveryStatus; operationId: WorkspaceApplyRecoveryOperationId } {
  if (!Object.hasOwn(snapshot, 'applyRecovery')) return { status: 'none', operationId: null }
  const recovery = record(snapshot.applyRecovery)
  if (!recovery) return { status: 'confirmation-required', operationId: null }
  if (recovery.schemaVersion === 'studio-apply-recovery/v1') {
    if (recovery.state === 'none') return { status: 'none', operationId: null }
    return { status: 'confirmation-required', operationId: null }
  }
  if (recovery.schemaVersion !== 'studio-apply-recovery/v2' || recovery.target !== 'local') {
    return { status: 'confirmation-required', operationId: null }
  }
  if (recovery.state === 'none') return { status: 'none', operationId: null }
  const operationId = isSafeApplyOperationID(recovery.operationId) ? recovery.operationId : null
  // A process restart during an apply is ambiguous: require an explicit retry.
  return { status: 'confirmation-required', operationId }
}

export async function restoreWorkspaceState(api: StudioAPI): Promise<{ tabs: WorkspaceTab[]; activeTabId: string | null; layout: Layout; writable: boolean; applyRecoveryStatus: WorkspaceApplyRecoveryStatus; applyRecoveryOperationId: WorkspaceApplyRecoveryOperationId }> {
  const fallback = { tabs: initialWorkspaceTabs(), activeTabId: 'canvas', layout: {}, writable: false, applyRecoveryStatus: 'confirmation-required' as const, applyRecoveryOperationId: null }
  try {
    const saved = await api.readWorkspaceState()
    if (saved.tabsJson === '[]') return { ...fallback, layout: parseLayout(saved.layoutJson), writable: true, applyRecoveryStatus: 'none', applyRecoveryOperationId: null }
    const preview = previewWorkspaceMigration(saved.tabsJson)
    const snapshot = JSON.parse(preview.after) as Record<string, unknown>
    if (!Array.isArray(snapshot.tabs)) return fallback
    const validTabs = snapshot.tabs.map(restoreTab).filter((tab): tab is WorkspaceTab => tab !== null)
    const tabs = validTabs.filter((tab, index) => validTabs.findIndex((candidate) => candidate.id === tab.id) === index)
    const activeTabId = typeof snapshot.activeTabId === 'string' && tabs.some((tab) => tab.id === snapshot.activeTabId) ? snapshot.activeTabId : tabs[0]?.id ?? null
    const recovery = restoredApplyRecovery(snapshot)
    return { tabs, activeTabId, layout: parseLayout(snapshot.layout ?? saved.layoutJson), writable: true, applyRecoveryStatus: recovery.status, applyRecoveryOperationId: recovery.operationId }
  } catch { return fallback }
}
