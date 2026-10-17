import { Component, useEffect, useMemo, useState } from 'react'
import type { DragEvent, ErrorInfo, ReactNode } from 'react'
import './App.css'
import type { StudioAPI } from './api/types'
import { selectProjectDirectory } from './api/wails'
import { WindowMinimise, WindowToggleMaximise, Quit } from '../wailsjs/runtime/runtime'
import { createStudioController } from './controllers/studioController'
import { text, type Copy } from './models/copy'
import type { TabKind } from './models/studio'
import { useStudioStore, type StudioPluginSurface } from './stores/studio'
import { ActivityBar, ArtifactsView, CommandPalette, CreateProjectDialog, GitSidebar, GraphView, HomeView, Inspector, OutputView, ServiceDialog, StudioPluginSurfaceFrame, StudioPluginsSidebar, ProblemsView, ReportsView, SettingsView } from './views/StudioViews'
import { StudioPluginsView } from './views/StudioPluginsView'
import { BrandMark } from './ui/BrandMark'
import { Boxes, Bug, ChevronDown, Command, GitBranch, Minus, MonitorDown, Play, RotateCw, Settings, Terminal, X } from 'lucide-react'

type Props = { api: StudioAPI }

type InspectorBoundaryState = { error: Error | null }

class InspectorErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, InspectorBoundaryState> {
  state: InspectorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): InspectorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Studio inspector render failed', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <section className="inspector-error" role="alert">
      <strong>Inspector failed to render</strong>
      <code>{this.state.error.message || 'Unknown render error'}</code>
      <button type="button" className="secondary-button compact" onClick={() => { this.setState({ error: null }); this.props.onRetry() }}>Retry</button>
    </section>
    return this.props.children
  }
}

export default function App({ api }: Props) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const controller = useMemo(() => createStudioController(api), [api])
  const locale = useStudioStore((state) => state.locale)
  const theme = useStudioStore((state) => state.theme)
  const workspace = useStudioStore((state) => state.workspace)
  const busy = useStudioStore((state) => state.busy)
  const initialized = useStudioStore((state) => state.initialized)
  const view = useStudioStore((state) => state.view)
  const tabs = useStudioStore((state) => state.tabs)
  const activeTabId = useStudioStore((state) => state.activeTabId)
  const studioPluginSurfaces = useStudioStore((state) => state.studioPluginSurfaces)
  const selected = useStudioStore((state) => state.selected)
  const error = useStudioStore((state) => state.error)
  const commandOpen = useStudioStore((state) => state.commandOpen)
  const createOpen = useStudioStore((state) => state.createOpen)
  const serviceOpen = useStudioStore((state) => state.serviceOpen)
  const stateHydrated = useStudioStore((state) => state.stateHydrated)
  const projects = useStudioStore((state) => state.projects)
  const toolchain = useStudioStore((state) => state.toolchain)
  const diagnostics = useStudioStore((state) => state.diagnostics)
  const cliEvents = useStudioStore((state) => state.cliEvents)
  const cliStreamState = useStudioStore((state) => state.cliStreamState)
  const runtimeOutput = useStudioStore((state) => state.runtimeOutput)
  const layout = useStudioStore((state) => state.layout)
  const pushCLIEvent = useStudioStore((state) => state.pushCLIEvent)
  const setCommandOpen = useStudioStore((state) => state.setCommandOpen)
  const setCreateOpen = useStudioStore((state) => state.setCreateOpen)
  const setError = useStudioStore((state) => state.setError)
  const setView = useStudioStore((state) => state.setView)
  const closeTab = useStudioStore((state) => state.closeTab)
  const reorderTabs = useStudioStore((state) => state.reorderTabs)
  const setActiveTab = useStudioStore((state) => state.setActiveTab)
  const openStudioPluginSurface = useStudioStore((state) => state.openStudioPluginSurface)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const t = text[locale]
  const nativeMacControls = navigator.userAgent.toLowerCase().includes('mac')

  useEffect(() => { void controller.refresh() }, [controller])
  useEffect(() => {
    if (!workspace?.project || cliStreamState !== 'idle') return
    const timer = window.setInterval(() => {
      if (useStudioStore.getState().cliStreamState === 'idle') void controller.refreshRuntimeStatuses()
    }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [cliStreamState, controller, workspace?.project?.id, workspace?.project?.rootPath])
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => api.onCLIEvent(pushCLIEvent), [api, pushCLIEvent])
  useEffect(() => { if (workspace?.project) void controller.loadDiagnostics() }, [controller, workspace?.project?.id, workspace?.git.revision])
  useEffect(() => { if (activeTab?.kind === 'reports') void controller.loadTraffic() }, [activeTab?.kind, controller])
  useEffect(() => { if (stateHydrated) void controller.persistWorkspace() }, [activeTabId, controller, layout, stateHydrated, tabs])
  useEffect(() => { void controller.loadStudioPluginSurfaces() }, [controller])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const state = useStudioStore.getState()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); state.setCommandOpen(true) }
      if (event.key === 'Escape') { state.setCommandOpen(false); state.setCreateOpen(false); state.setServiceOpen(false) }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Tab') {
        event.preventDefault()
        const current = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
        if (state.tabs.length > 1) state.setActiveTab(state.tabs[(current + 1) % state.tabs.length]?.id ?? '')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  async function chooseAndOpen() {
    try {
      const path = await selectProjectDirectory()
      if (path) await controller.openProject(path)
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : t.openError) }
  }
  function openTab(kind: TabKind) {
    if (kind === 'studio-plugin') return
    useStudioStore.getState().navigate(kind)
  }
  function openPluginSurface(surface: StudioPluginSurface) {
    const serviceId = selected?.kind === 'service' ? selected.id : undefined
    openStudioPluginSurface(surface, { projectId: workspace?.project?.id, serviceId })
  }
  function dismissError() { setError(null) }
  function beginTabDrag(event: DragEvent<HTMLDivElement>, id: string) {
    event.dataTransfer.setData('text/studio-tab', id)
    event.dataTransfer.effectAllowed = 'move'
  }
  function endTabDrag(event: DragEvent<HTMLDivElement>, id: string) {
    event.preventDefault()
    const from = event.dataTransfer.getData('text/studio-tab')
    if (from) reorderTabs(from, id)
  }
  async function debugProject() {
    for (const service of workspace?.graph.services ?? []) {
      await controller.runtimeCommand('runtime.inspect', service.id)
      await controller.runtimeCommand('runtime.logs', service.id)
    }
  }

  if (!initialized) return <div className="loading-screen"><BrandMark /><span>{t.loading}</span></div>
  const hasProject = Boolean(workspace?.project)
  const showWorkspace = hasProject && view === 'workspace'
  const sidebar = showWorkspace && workspace && activeTab?.kind === 'git'
      ? <aside className="context-sidebar"><GitSidebar workspace={workspace} t={t} controller={controller} /></aside>
      : showWorkspace && workspace && activeTab?.kind === 'studio-plugins'
        ? <StudioPluginsSidebar workspace={workspace} t={t} surfaces={studioPluginSurfaces} onOpen={openPluginSurface} />
        : null

  let content = null
  if (showWorkspace && workspace && activeTab) {
    switch (activeTab.kind) {
      case 'canvas': content = <GraphView controller={controller} workspace={workspace} t={t} />; break
      case 'git': content = <GitWorkspaceHint t={t} />; break
      case 'reports': content = <ReportsView controller={controller} t={t} />; break
      case 'studio-plugins': content = <StudioPluginsView controller={controller} surfaces={studioPluginSurfaces} onOpen={openPluginSurface} t={t} />; break
      case 'problems': content = <ProblemsView diagnostics={diagnostics} t={t} />; break
      case 'output': content = <OutputView cliEvents={cliEvents} runtimeOutput={runtimeOutput} streamState={cliStreamState} controller={controller} t={t} />; break
      case 'studio-plugin': {
        const surface = studioPluginSurfaces.find((item) => item.studioPluginId === activeTab.studioPluginId && item.version === activeTab.studioPluginVersion && item.id === activeTab.surfaceId)
        const selectedService = activeTab.projectId === workspace.project?.id && activeTab.serviceId
          ? workspace.graph.services.find((service) => service.id === activeTab.serviceId)
          : undefined
        content = <StudioPluginSurfaceFrame
          tab={activeTab}
          controller={controller}
          surface={surface}
          project={workspace.project ? { id: workspace.project.id, name: workspace.project.name } : null}
          service={selectedService ? { id: selectedService.id, name: selectedService.name, version: selectedService.version } : null}
        />
        break
      }
    }
  }

  return <div className="studio-app">
    <header className={`topbar ${nativeMacControls ? 'mac-titlebar' : ''}`}>
      {!nativeMacControls && <div className="window-controls" aria-label={locale === 'ru' ? 'Управление окном' : 'Window controls'}>
        <button type="button" title={locale === 'ru' ? 'Свернуть' : 'Minimize'} aria-label={locale === 'ru' ? 'Свернуть' : 'Minimize'} onClick={WindowMinimise}><Minus size={13} /></button>
        <button type="button" title={locale === 'ru' ? 'Развернуть' : 'Maximize'} aria-label={locale === 'ru' ? 'Развернуть' : 'Maximize'} onClick={WindowToggleMaximise}><MonitorDown size={13} /></button>
        <button type="button" title={locale === 'ru' ? 'Закрыть' : 'Close'} aria-label={locale === 'ru' ? 'Закрыть' : 'Close'} onClick={Quit}><X size={13} /></button>
      </div>}
      {hasProject && <button type="button" className="workspace-switcher" title={locale === 'ru' ? 'Сменить рабочее пространство' : 'Switch workspace'} aria-expanded={workspaceMenuOpen} onClick={() => { setWorkspaceMenuOpen((open) => !open); }}>
        <span className="workspace-dot" /><span className="workspace-name">{workspace?.project?.name}</span><ChevronDown size={14} />
      </button>}
      <div className="titlebar-drag" aria-hidden="true" />
      {hasProject && <div className="topbar-status">
        <span className={`status-pill ${workspace?.git.available ? workspace.git.dirty ? 'warning' : 'success' : 'neutral'}`}><GitBranch size={12} />{workspace?.git.available ? workspace.git.branch || 'HEAD' : t.noGit}</span>
        <span className={`status-pill ${toolchain?.cliAvailable ? 'success' : 'warning'}`}><Terminal size={12} />CLI {toolchain?.cliAvailable ? toolchain.cliVersion || 'ok' : t.cliMissing}</span>
      </div>}
      {hasProject && <div className="topbar-run-controls" aria-label={locale === 'ru' ? 'Управление проектом' : 'Project controls'}>
        <button type="button" className="secondary-button compact" disabled={busy || !workspace?.graph.services.length} title={locale === 'ru' ? 'Запустить все подключённые сервисы проекта' : 'Run all connected project services'} onClick={() => void controller.run('runtime.start')}><Play size={14} />{locale === 'ru' ? 'Запуск' : 'Run'}</button>
        <button type="button" className="secondary-button compact" disabled={busy || !workspace?.graph.services.length} title={locale === 'ru' ? 'Перезапустить все подключённые сервисы проекта' : 'Restart all connected project services'} onClick={() => void controller.run('runtime.restart')}><RotateCw size={14} />{locale === 'ru' ? 'Перезапуск' : 'Restart'}</button>
        <button type="button" className="secondary-button compact" disabled={busy || !workspace?.graph.services.length} title={locale === 'ru' ? 'Inspect и логи всех сервисов проекта' : 'Inspect and logs for every project service'} onClick={() => void debugProject()}><Bug size={14} />Debug</button>
      </div>}
      <button type="button" className="icon-button" title={t.command} aria-label={t.command} onClick={() => { setCommandOpen(true) }}><Command size={16} /></button>
      <button type="button" className={`icon-button ${view === 'settings' ? 'active' : ''}`} title={t.settings} aria-label={t.settings} onClick={() => { setView(view === 'settings' ? (hasProject ? 'workspace' : 'home') : 'settings') }}><Settings size={16} /></button>
      <button type="button" className="icon-button logo-button" title={t.home} aria-label={t.home} onClick={() => { setView('home') }}><BrandMark /></button>
    </header>

    {showWorkspace && <div className="tab-strip" role="tablist" aria-label={locale === 'ru' ? 'Рабочие вкладки' : 'Workspace tabs'}>
      {tabs.map((tab) => <div key={tab.id} role="tab" tabIndex={0} draggable="true" aria-selected={tab.id === activeTabId} className={`document-tab ${tab.id === activeTabId ? 'active' : ''}`} onClick={() => { setActiveTab(tab.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveTab(tab.id) } }} onDragStart={(event) => { beginTabDrag(event, tab.id); }} onDragOver={(event) => { event.preventDefault() }} onDrop={(event) => { endTabDrag(event, tab.id); }}>
        {tab.kind === 'canvas' ? <Boxes size={14} className="tab-icon" /> : <span className="tab-kind-mark" />}
        <span>{tab.title}</span>
        <button type="button" className="tab-close" title={locale === 'ru' ? 'Закрыть вкладку' : 'Close tab'} aria-label={`${locale === 'ru' ? 'Закрыть' : 'Close'} ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }}><X size={13} /></button>
      </div>)}
    </div>}

    {showWorkspace && <div className="shell-body">
      <ActivityBar activeId={activeTab?.id ?? null} t={t} onNavigate={openTab} surfaces={studioPluginSurfaces} onOpenSurface={openPluginSurface} />
      {sidebar}
      <main className="workbench">{content ?? <div className="workspace-empty"><span>{locale === 'ru' ? 'Выберите раздел в боковой панели' : 'Open a workspace from the activity bar'}</span></div>}</main>
      {workspace && (activeTab?.kind === 'canvas' || activeTab?.kind === 'studio-plugin') && <InspectorErrorBoundary key={`${activeTab.kind}:${selected?.kind ?? ''}:${selected?.id ?? ''}`} onRetry={() => { void controller.refreshGraph() }}><Inspector controller={controller} workspace={workspace} selected={activeTab.kind === 'canvas' ? selected : null} output={runtimeOutput} /></InspectorErrorBoundary>}
    </div>}

    {view === 'settings' && <main className="global-page"><SettingsView controller={controller} locale={locale} theme={theme} toolchain={toolchain} t={t} pluginManager={<StudioPluginsView controller={controller} surfaces={studioPluginSurfaces} onOpen={openPluginSurface} t={t} />} artifactsManager={<ArtifactsView controller={controller} t={t} />} /></main>}
    {view !== 'settings' && (!hasProject || view === 'home') && <main className="global-page"><HomeView controller={controller} locale={locale} theme={theme} projects={projects} toolchain={toolchain} error={error} onOpen={() => void chooseAndOpen()} onCreate={() => { setCreateOpen(true) }} onOpenProject={(root) => void controller.openProject(root)} /></main>}

    {busy && <div className="busy-overlay" role="status" aria-live="polite"><div className="busy-spinner" /><span>{t.loading}</span></div>}
    {error && showWorkspace && <div className="toast error"><span>{error}</span><button type="button" onClick={dismissError}>×</button></div>}
    {workspaceMenuOpen && <div className="workspace-menu-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceMenuOpen(false) }}><div className="workspace-menu" role="menu"><div className="workspace-menu-heading">{locale === 'ru' ? 'Рабочие пространства' : 'Workspaces'}</div>{projects.slice(0, 8).map((project) => <button type="button" role="menuitem" key={project.rootPath} className="workspace-menu-item" onClick={() => { setWorkspaceMenuOpen(false); void controller.openProject(project.rootPath) }}><Boxes size={15} /><span><strong>{project.name}</strong><small>{project.rootPath}</small></span></button>)}<div className="workspace-menu-actions"><button type="button" className="secondary-button compact" onClick={() => { setWorkspaceMenuOpen(false); void chooseAndOpen() }}>{t.open}</button><button type="button" className="primary-button compact" onClick={() => { setWorkspaceMenuOpen(false); setCreateOpen(true) }}>{t.create}</button></div></div></div>}
    {commandOpen && <CommandPalette controller={controller} t={t} onSettings={() => { setView('settings'); }} />}
    {createOpen && <CreateProjectDialog controller={controller} t={t} />}
    {serviceOpen && showWorkspace && <ServiceDialog controller={controller} t={t} />}
  </div>
}

function GitWorkspaceHint({ t }: { t: Copy }) { return <div className="workspace-hint"><h1>{t.git}</h1><p>{t.gitHint}</p></div> }
function applyTheme(theme: import('./api/types').ThemePreference) { const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme; document.documentElement.dataset.theme = resolved }
