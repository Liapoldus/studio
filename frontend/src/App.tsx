import { useEffect, useMemo } from 'react'
import './App.css'
import type { StudioAPI, ThemePreference } from './api/types'
import { selectProjectDirectory } from './api/wails'
import { createStudioController } from './controllers/studioController'
import type { NavItem } from './models/studio'
import { text } from './models/copy'
import { useStudioStore } from './stores/studio'
import { ActivityBar, ArtifactsView, BottomDock, CommandPalette, CreateProjectDialog, FilesSidebar, FileDocument, GitSidebar, GraphView, HomeView, Inspector, PluginsSidebar, PluginDialog, RuntimeView, SettingsView } from './views/StudioViews'

type Props = { api: StudioAPI }

export default function App({ api }: Props) {
  const controller = useMemo(() => createStudioController(api), [api])
  const locale = useStudioStore((state) => state.locale)
  const theme = useStudioStore((state) => state.theme)
  const workspace = useStudioStore((state) => state.workspace)
  const busy = useStudioStore((state) => state.busy)
  const initialized = useStudioStore((state) => state.initialized)
  const screen = useStudioStore((state) => state.screen)
  const documents = useStudioStore((state) => state.documents)
  const activeDocument = useStudioStore((state) => state.activeDocument)
  const selected = useStudioStore((state) => state.selected)
  const dock = useStudioStore((state) => state.dock)
  const error = useStudioStore((state) => state.error)
  const commandOpen = useStudioStore((state) => state.commandOpen)
  const createOpen = useStudioStore((state) => state.createOpen)
  const pluginOpen = useStudioStore((state) => state.pluginOpen)
  const stateHydrated = useStudioStore((state) => state.stateHydrated)
  const projects = useStudioStore((state) => state.projects)
  const toolchain = useStudioStore((state) => state.toolchain)
  const diagnostics = useStudioStore((state) => state.diagnostics)
  const cliEvents = useStudioStore((state) => state.cliEvents)
  const traffic = useStudioStore((state) => state.traffic)
  const runtimeOutput = useStudioStore((state) => state.runtimeOutput)
  const pushCLIEvent = useStudioStore((state) => state.pushCLIEvent)
  const setCommandOpen = useStudioStore((state) => state.setCommandOpen)
  const setCreateOpen = useStudioStore((state) => state.setCreateOpen)
  const setError = useStudioStore((state) => state.setError)
  const closeDocument = useStudioStore((state) => state.closeDocument)
  const t = text[locale]

  useEffect(() => { void controller.refresh() }, [controller])
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => api.onCLIEvent(pushCLIEvent), [api, pushCLIEvent])
  useEffect(() => { if (workspace?.project) void controller.loadDiagnostics() }, [controller, workspace?.project?.id, workspace?.git.revision])
  useEffect(() => { if (dock === 'reports') void controller.loadTraffic() }, [controller, dock])
  useEffect(() => { if (stateHydrated) void controller.persistWorkspace() }, [controller, stateHydrated, screen, activeDocument, dock, documents])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const state = useStudioStore.getState()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); state.setCommandOpen(true) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); const document = state.documents.find((item) => item.id === state.activeDocument); if (document?.kind === 'file') void controller.saveDocument(document.id) }
      if (event.key === 'Escape') { state.setCommandOpen(false); state.setCreateOpen(false); state.setPluginOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); }
  }, [controller])

  async function chooseAndOpen() {
    try {
      const path = await selectProjectDirectory()
      if (path) await controller.openProject(path)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t.openError)
    }
  }
  function navigate(item: NavItem) { useStudioStore.getState().navigate(item) }
  function dismissError() { setError(null) }

  if (!initialized) return <div className="loading-screen"><div className="brand-mark">L</div><span>{t.loading}</span></div>
  const home = !workspace?.project || screen === 'home'
  const document = documents.find((item) => item.id === activeDocument)
  const workspaceView = workspace?.project && !home ? <div className="studio-app">
    <header className="topbar"><button type="button" className="icon-button logo-button" title={t.home} onClick={() => { navigate('home'); }}><span className="brand-mark">L</span></button><button type="button" className="workspace-switcher" title="Switch workspace" onClick={() => { navigate('home'); }}><span className="workspace-dot" /><span className="workspace-name">{workspace.project.name}</span><span>⌄</span></button><div className="document-tabs">{documents.map((item) => <button type="button" key={item.id} className={`document-tab ${activeDocument === item.id ? 'active' : ''}`} onClick={() => { useStudioStore.getState().setActiveDocument(item.id); }}><span>{item.kind === 'canvas' ? '▦' : '·'}</span><span>{item.title}</span>{item.dirty && <span className="dirty-dot" />}{item.id !== 'canvas' && <span onClick={(event) => { event.stopPropagation(); closeDocument(item.id) }}>×</span>}</button>)}</div><div className="topbar-actions"><span className={`status-pill ${workspace.git.available ? workspace.git.dirty ? 'warning' : 'success' : 'neutral'}`}>⌘ {workspace.git.available ? workspace.git.branch || 'HEAD' : t.noGit}</span><span className={`status-pill ${toolchain?.cliAvailable ? 'success' : 'warning'}`}>CLI {toolchain?.cliAvailable ? toolchain.cliVersion || 'ok' : t.cliMissing}</span><button type="button" className="icon-button" title={t.command} onClick={() => { setCommandOpen(true); }}>⌘</button><button type="button" className="icon-button" title={t.settings} onClick={() => { navigate('settings'); }}>⚙</button></div></header>
    <div className="shell-body"><ActivityBar screen={screen} t={t} onNavigate={navigate} />{screen === 'files' && <FilesSidebar workspace={workspace} t={t} controller={controller} />}{screen === 'git' && <aside className="context-sidebar"><GitSidebar workspace={workspace} t={t} controller={controller} /></aside>}{screen === 'plugins' && <PluginsSidebar workspace={workspace} t={t} />}{<main className="workbench">{screen === 'settings' ? <SettingsView controller={controller} locale={locale} theme={theme} toolchain={toolchain} t={t} /> : screen === 'artifacts' ? <ArtifactsView controller={controller} t={t} /> : screen === 'runtime' ? <RuntimeView controller={controller} workspace={workspace} t={t} /> : document?.kind === 'file' ? <FileDocument controller={controller} document={document} theme={theme} t={t} /> : <GraphView controller={controller} workspace={workspace} t={t} />}</main>}<Inspector controller={controller} workspace={workspace} selected={selected} output={runtimeOutput} /></div>
    <BottomDock controller={controller} active={dock} diagnostics={diagnostics} cliEvents={cliEvents} traffic={traffic} workspace={workspace} t={t} />
  </div> : <HomeView controller={controller} locale={locale} theme={theme} projects={projects} toolchain={toolchain} error={error} onOpen={() => void chooseAndOpen()} onCreate={() => { setCreateOpen(true); }} onOpenProject={(root) => void controller.openProject(root)} />
  return <>{workspaceView}{busy && <div className="busy-overlay" role="status" aria-live="polite"><div className="busy-spinner" /><span>{t.loading}</span></div>}{error && !home && <div className="toast error"><span>{error}</span><button type="button" onClick={dismissError}>×</button></div>}{commandOpen && <CommandPalette controller={controller} t={t} />}{createOpen && <CreateProjectDialog controller={controller} t={t} />}{pluginOpen && !home && <PluginDialog controller={controller} t={t} />}</>
}

function applyTheme(theme: ThemePreference) { const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme; document.documentElement.dataset.theme = resolved }
