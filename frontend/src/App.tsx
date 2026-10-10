import { useEffect, useState } from 'react'
import './App.css'
import type { CLIEvent, Diagnostic, EditorAssociation, GitBranch, GitCommit, GitDiff, GitRemote, InstalledPluginState, PluginLink, ProductInfo, RuntimePlugin, StudioAPI, ThemePreference, TrafficRecordView, Workspace } from './api/types'
import { selectProjectDirectory } from './api/wails'

type Props = { api: StudioAPI }

function App({ api }: Props) {
  const [info, setInfo] = useState<ProductInfo | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [projects, setProjects] = useState<Awaited<ReturnType<StudioAPI['listProjects']>>>([])
  const [screen, setScreen] = useState<'home' | 'project'>('home')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginState[]>([])
  const [pluginManifests, setPluginManifests] = useState<PluginInspection[]>([])
  const [activeSurface, setActiveSurface] = useState<SurfaceView | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [pluginInspection, setPluginInspection] = useState<PluginInspection | null>(null)
  const [pluginPackage, setPluginPackage] = useState('')
  const [pluginBusy, setPluginBusy] = useState(false)
  const [toolOutput, setToolOutput] = useState<string | null>(null)
  const [pluginProcessStates, setPluginProcessStates] = useState<Record<string, string>>({})
  const [theme, setTheme] = useState<ThemePreference>('system')

  useEffect(() => {
    void Promise.all([api.productInfo(), api.listProjects(), api.workspace(), api.clientPreferences()])
      .then(([productInfo, knownProjects, currentWorkspace, preferences]) => {
        setInfo(productInfo)
        setProjects(knownProjects)
        setWorkspace(currentWorkspace)
        setTheme(preferences.theme)
        applyTheme(preferences.theme)
        if (currentWorkspace.project) setScreen('project')
      })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить Studio') })
    void api.installedStudioPlugins().then(setInstalledPlugins).catch(() => { setInstalledPlugins([]) })
    void api.installedStudioPluginManifests().then((value) => { setPluginManifests(JSON.parse(value) as PluginInspection[]) }).catch(() => { setPluginManifests([]) })
  }, [api])

  async function changeTheme(next: ThemePreference) {
    try {
      await api.saveClientPreferences(next)
      setTheme(next)
      applyTheme(next)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить тему')
    }
  }

  async function inspectPluginPackage() {
    setPluginBusy(true)
    setError(null)
    try {
      const packagePath = await api.selectStudioPluginPackage()
      if (!packagePath) return
      const inspection = JSON.parse(await api.inspectStudioPlugin(packagePath)) as PluginInspection
      setPluginPackage(packagePath)
      setPluginInspection(inspection)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось проверить Studio plugin')
    } finally {
      setPluginBusy(false)
    }
  }

  async function installPlugin(grantedPermissions: string[]) {
    if (!pluginInspection || !pluginPackage) return
    setPluginBusy(true)
    try {
      await api.installStudioPlugin(pluginPackage, true, 'Explicitly approved in Studio trust dialog', grantedPermissions)
      setInstalledPlugins(await api.installedStudioPlugins())
      setPluginManifests(JSON.parse(await api.installedStudioPluginManifests()) as PluginInspection[])
      setPluginInspection(null)
      setPluginPackage('')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось установить Studio plugin')
    } finally {
      setPluginBusy(false)
    }
  }

  async function removePlugin(plugin: InstalledPluginState) {
    if (!window.confirm(`Remove Studio plugin ${plugin.id}@${plugin.version}? Previous installed versions remain available.`)) return
    setPluginBusy(true)
    try {
      await api.removeStudioPlugin(plugin.id, plugin.version)
      setInstalledPlugins(await api.installedStudioPlugins())
      setPluginManifests(JSON.parse(await api.installedStudioPluginManifests()) as PluginInspection[])
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить Studio plugin')
    } finally {
      setPluginBusy(false)
    }
  }

  async function openSurface(plugin: InstalledPluginState, surface: PluginSurfaceDescriptor) {
    setSurfaceError(null)
    try {
      const payload = JSON.parse(await api.readStudioPluginSurface(plugin.id, plugin.version, surface.id)) as SurfacePayload
      setActiveSurface({ plugin, surface: payload.surface, schema: payload.schema })
    } catch (reason: unknown) {
      setSurfaceError(reason instanceof Error ? reason.message : 'Не удалось открыть declarative surface')
      setActiveSurface(null)
    }
  }

  async function runPluginTool(plugin: InstalledPluginState, toolId: string) {
    setToolOutput(null)
    try {
      setToolOutput(await api.runStudioPluginTool(plugin.id, plugin.version, toolId, []))
    } catch (reason: unknown) {
      setToolOutput(reason instanceof Error ? reason.message : 'Не удалось запустить companion tool')
    }
  }

  async function togglePluginProcess(plugin: InstalledPluginState) {
    const key = `${plugin.id}@${plugin.version}`
    const current = pluginProcessStates[key] ?? 'stopped'
    try {
      if (current === 'running' || current === 'starting' || current === 'stopping') {
        await api.stopStudioPluginProcess(plugin.id, plugin.version)
        setPluginProcessStates((states) => ({ ...states, [key]: 'stopping' }))
      } else {
        const status = JSON.parse(await api.startStudioPluginProcess(plugin.id, plugin.version)) as { state?: string; warning?: string; sandboxed?: boolean }
        setPluginProcessStates((states) => ({ ...states, [key]: status.state ?? 'running' }))
        if (status.warning) setToolOutput(JSON.stringify({ sandboxed: status.sandboxed ?? false, warning: status.warning }, null, 2))
      }
    } catch (reason: unknown) {
      setToolOutput(reason instanceof Error ? reason.message : 'Не удалось изменить lifecycle Studio plugin process')
      setPluginProcessStates((states) => ({ ...states, [key]: 'failed' }))
    }
  }

  async function openProject(root?: string) {
    setBusy(true)
    setError(null)
    try {
      const selectedRoot = root ?? await selectProjectDirectory()
      if (!selectedRoot) return
      const opened = await api.openProject(selectedRoot)
      setWorkspace(opened)
      setProjects(await api.listProjects())
      setScreen('project')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть project')
    } finally {
      setBusy(false)
    }
  }

  function requestOpenProject(root?: string) {
    void openProject(root)
  }

  if (screen === 'project' && workspace?.project) {
    return <ProjectShell api={api} info={info} workspace={workspace} onWorkspaceChange={setWorkspace} onHome={() => { setScreen('home') }} />
  }

  return (
    <main className="studio-shell home-shell">
      <header className="studio-header">
        <div className="studio-mark" aria-hidden="true">L</div>
        <div>
          <p className="eyebrow">Liapoldus ecosystem</p>
          <h1>{info?.name ?? 'Liapoldus Studio'}</h1>
        </div>
        <label className="theme-control">Theme<select aria-label="Theme" value={theme} onChange={(event) => { void changeTheme(event.target.value as ThemePreference) }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      </header>

      <section className="welcome-card hero-card">
        <div>
          <p className="eyebrow">Desktop development workbench</p>
          <h2>Проекты, plugins и связи в одном рабочем пространстве</h2>
          <p>{info?.description ?? 'Среда разработки проектов, конфигураций и Git-версий Liapoldus.'}</p>
        </div>
      <button type="button" className="primary-button" onClick={() => { requestOpenProject() }} disabled={busy}>
          {busy ? 'Открываем…' : 'Открыть project'}
        </button>
      </section>

      {error && <div className="callout callout-error" role="alert">{error}</div>}

      <section className="home-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Недавние проекты</h2>
          </div>
          <span className="muted-label">{projects.length} сохранено</span>
        </div>
        {projects.length === 0 ? (
          <div className="empty-state">
            <strong>Пока нет открытых проектов</strong>
            <span>Выберите папку с `project.yaml`, чтобы начать работу.</span>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <button key={project.id} type="button" className="project-card" onClick={() => { requestOpenProject(project.rootPath) }}>
                <span className="project-card-mark">P</span>
                <span className="project-card-copy">
                  <strong>{project.name}</strong>
                  <small>{project.rootPath}</small>
                </span>
                <span className="project-card-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="home-section plugin-home-section">
        <div className="section-heading">
          <div><p className="eyebrow">Local extensions</p><h2>Installed Studio plugins</h2></div>
          <button type="button" className="secondary-button plugin-import-button" disabled={pluginBusy} onClick={() => { void inspectPluginPackage() }}>{pluginBusy ? 'Checking…' : 'Import package'}</button>
        </div>
        {installedPlugins.length === 0 ? <div className="empty-state"><strong>No local Studio plugins</strong><span>Import a trusted `.studio-plugin` package to add declarative panels and companion tools.</span></div> : <div className="installed-plugin-list">{installedPlugins.map((plugin) => { const manifest = pluginManifests.find((item) => item.manifest.id === plugin.id && item.manifest.version === plugin.version); const processState = pluginProcessStates[`${plugin.id}@${plugin.version}`] ?? 'stopped'; return <div className="installed-plugin-row" key={`${plugin.id}-${plugin.version}`}><span className="project-card-mark">S</span><span><strong>{plugin.id}</strong><small>v{plugin.version} · {plugin.signed ? 'signed metadata' : 'local package'} · {plugin.enabled ? 'enabled' : 'disabled'}</small>{manifest && <><small className="plugin-surface-list">{manifest.manifest.surfaces?.map((surface) => `${surface.kind}: ${surface.title || surface.id}`).join(' · ') || 'No declarative surfaces'}{manifest.manifest.tools?.length ? ` · ${String(manifest.manifest.tools.length)} tools` : ''}</small>{manifest.manifest.grantedPermissions?.length ? <small className="plugin-surface-list">Granted: {manifest.manifest.grantedPermissions.join(', ')}</small> : null}{manifest.manifest.process && <button type="button" className="surface-link" onClick={() => { void togglePluginProcess(plugin) }}>{processState === 'running' ? 'Stop backend process' : `Start backend process · ${processState}`}</button>}{manifest.manifest.surfaces?.map((surface) => <button type="button" className="surface-link" key={surface.id} onClick={() => { void openSurface(plugin, surface) }}>{surface.title || surface.id}</button>)}{manifest.manifest.tools?.map((tool) => <button type="button" className="surface-link" key={tool.id} onClick={() => { void runPluginTool(plugin, tool.id) }}>Run {tool.id}</button>)}<button type="button" className="surface-link" disabled={pluginBusy} onClick={() => { void removePlugin(plugin) }}>Remove version / rollback</button></>}</span></div> })}</div>}
        {surfaceError && <div className="callout callout-error" role="alert">{surfaceError}</div>}
        {toolOutput && <pre className="tool-output" aria-label="Companion tool output">{toolOutput}</pre>}
        {activeSurface && <PluginSurfacePreview view={activeSurface} onClose={() => { setActiveSurface(null) }} />}
      </section>

      {pluginInspection && <PluginTrustDialog inspection={pluginInspection} onCancel={() => { setPluginInspection(null); setPluginPackage('') }} onApprove={(grantedPermissions) => { void installPlugin(grantedPermissions) }} busy={pluginBusy} />}

      <footer className="home-footer">
        <span>Возможности: {info?.workspaceFeatures.join(' · ') ?? 'project · file-tree · git · cli-reports'}</span>
        <span>Core подключается только через liapoldus CLI</span>
      </footer>
    </main>
  )
}

function applyTheme(theme: ThemePreference) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

type PluginInspection = {
  manifest: { id: string; name: string; version: string; studioRange: string; permissions?: string[]; grantedPermissions?: string[]; process?: { executable: string; platforms: string[]; timeoutMillis?: number }; surfaces?: PluginSurfaceDescriptor[]; tools?: Array<{ id: string; version: string; executable: string; platforms: string[] }> }
  digest: string
  files: string[]
  signed: boolean
}

type PluginSurfaceDescriptor = { id: string; kind: string; title: string; route?: string; schema?: string; toolId?: string }
type SurfacePayload = { surface: PluginSurfaceDescriptor; schema: Schema }
type SurfaceView = { plugin: InstalledPluginState; surface: PluginSurfaceDescriptor; schema: Schema }

function PluginTrustDialog({ inspection, onCancel, onApprove, busy }: { inspection: PluginInspection; onCancel: () => void; onApprove: (grantedPermissions: string[]) => void; busy: boolean }) {
  const permissions = inspection.manifest.permissions ?? []
  const [granted, setGranted] = useState<string[]>([])
  function togglePermission(permission: string) {
    setGranted((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission])
  }
  return <div className="trust-backdrop" role="presentation"><section className="trust-dialog" role="dialog" aria-modal="true" aria-labelledby="trust-dialog-title"><p className="eyebrow">Explicit local trust</p><h2 id="trust-dialog-title">Install {inspection.manifest.name}?</h2><p className="trust-dialog-copy">Studio will install this package locally and register only its declared surfaces and tools. It will not receive Core credentials.</p><div className="trust-summary"><InspectorRow label="Package" value={`${inspection.manifest.id} · v${inspection.manifest.version}`} /><InspectorRow label="Digest" value={inspection.digest} /><InspectorRow label="Signature metadata" value={inspection.signed ? 'Present — still reviewed locally' : 'Unsigned local package'} /><InspectorRow label="Permissions" value={permissions.length ? permissions.join(', ') : 'None declared'} /><InspectorRow label="Surfaces" value={inspection.manifest.surfaces?.length ? inspection.manifest.surfaces.map((surface) => `${surface.kind}: ${surface.title || surface.id}`).join(', ') : 'None'} /><InspectorRow label="Tools" value={inspection.manifest.tools?.length ? inspection.manifest.tools.map((tool) => `${tool.id} v${tool.version}`).join(', ') : 'None'} /></div>{permissions.length > 0 && <fieldset className="permission-grants"><legend>Grant capabilities</legend><p className="inspector-hint">Only selected declared permissions are stored for this package digest.</p>{permissions.map((permission) => <label key={permission}><input type="checkbox" checked={granted.includes(permission)} onChange={() => { togglePermission(permission) }} />{permission}</label>)}</fieldset>}<div className="trust-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="primary-button" onClick={() => { onApprove(granted) }} disabled={busy || granted.length !== permissions.length}>{busy ? 'Installing…' : 'Approve and install'}</button></div></section></div>
}

function PluginSurfacePreview({ view, onClose }: { view: SurfaceView; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => buildInitialValues(view.schema, {}))
  return <section className="surface-preview" aria-label={`${view.surface.title || view.surface.id} surface`}><div className="surface-preview-heading"><div><span className="eyebrow">Host-controlled {view.surface.kind}</span><h3>{view.surface.title || view.surface.id}</h3><span className="inspector-hint">{view.plugin.id} · v{view.plugin.version}</span></div><button type="button" className="secondary-button" onClick={onClose}>Close</button></div><p className="inspector-hint">This declarative surface is rendered by Studio from plugin-provided schema. Plugin HTML/JS is never loaded into the renderer.</p><SchemaObjectForm schema={view.schema} value={values} onChange={setValues} /></section>
}

function ProjectShell({ api, info, workspace, onWorkspaceChange, onHome }: { api: StudioAPI; info: ProductInfo | null; workspace: Workspace; onWorkspaceChange: (workspace: Workspace) => void; onHome: () => void }) {
  const [selection, setSelection] = useState<{ kind: 'plugin' | 'link'; id: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileQuery, setFileQuery] = useState('')
  const [fileFilter, setFileFilter] = useState<'all' | 'services' | 'modules' | 'schemas' | 'changed'>('all')
  const [workspaceStateReady, setWorkspaceStateReady] = useState(false)
  const [editorAssociations, setEditorAssociations] = useState<EditorAssociation[]>([])
  const [associationFile, setAssociationFile] = useState<string | null>(null)
  const [associationPattern, setAssociationPattern] = useState('')
  const [associationApplication, setAssociationApplication] = useState('')
  const [associationError, setAssociationError] = useState<string | null>(null)
  const [cliError, setCLIError] = useState<string | null>(null)
  const [cliRunning, setCLIRunning] = useState(false)
  const [cliEvent, setCLIEvent] = useState<CLIEvent | null>(null)
  const [cliEvents, setCLIEvents] = useState<CLIEvent[]>([])
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [targets, setTargets] = useState<TargetSnapshot[]>([])
  const [remoteHandoff, setRemoteHandoff] = useState('')
  const [bottomTab, setBottomTab] = useState<'problems' | 'cli' | 'git' | 'reports' | 'tools'>('problems')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [traffic, setTraffic] = useState<TrafficRecordView[]>([])
  const [trafficLoading, setTrafficLoading] = useState(false)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const selectedPlugin = selection?.kind === 'plugin'
    ? workspace.graph.plugins.find((plugin) => plugin.id === selection.id) ?? null
    : null
  const selectedLink = selection?.kind === 'link'
    ? workspace.graph.links.find((link) => link.id === selection.id) ?? null
    : null
  const changedPaths = new Set(workspace.git.changes.map((change) => change.path))
  const visibleFiles = workspace.files.filter((file) => {
    const query = fileQuery.trim().toLowerCase()
    if (query && !file.path.toLowerCase().includes(query)) return false
    if (fileFilter === 'changed' && !changedPaths.has(file.path)) return false
    if (fileFilter !== 'all' && fileFilter !== 'changed' && !file.path.startsWith(`${fileFilter}/`)) return false
    return true
  }).slice(0, 200)

  useEffect(() => api.onCLIEvent((event) => {
    setCLIEvent(event)
    setCLIEvents((events) => [...events, event].slice(-100))
    setTargets((current) => mergeTargetEvent(current, event))
    if (event.type === 'run.completed' || event.type === 'run.failed') setCLIRunning(false)
  }), [api])

  useEffect(() => {
    void api.editorAssociations().then(setEditorAssociations).catch(() => { setEditorAssociations([]) })
    void api.diagnostics().then(setDiagnostics).catch(() => { setDiagnostics([]) })
  }, [api])

  useEffect(() => {
    void api.readWorkspaceState().then((state) => {
      try {
        const layout = JSON.parse(state.layoutJson) as { selection?: { kind: 'plugin' | 'link'; id: string } | null }
        const tabs = JSON.parse(state.tabsJson) as { bottomTab?: 'problems' | 'cli' | 'git' | 'reports' | 'tools' }
        const filters = JSON.parse(state.filtersJson) as { fileQuery?: string; fileFilter?: 'all' | 'services' | 'modules' | 'schemas' | 'changed' }
        if (layout.selection) setSelection(layout.selection)
        if (tabs.bottomTab) setBottomTab(tabs.bottomTab)
        if (typeof filters.fileQuery === 'string') setFileQuery(filters.fileQuery)
        if (filters.fileFilter) setFileFilter(filters.fileFilter)
      } catch {
        // Corrupt local UI state is non-fatal; canonical Project remains intact.
      }
      setWorkspaceStateReady(true)
    }).catch(() => { setWorkspaceStateReady(true) })
  }, [api])

  useEffect(() => {
    if (!workspaceStateReady || !workspace.project) return
    void api.writeWorkspaceState({
      projectId: workspace.project.id,
      layoutJson: JSON.stringify({ selection }),
      tabsJson: JSON.stringify({ bottomTab }),
      filtersJson: JSON.stringify({ fileQuery, fileFilter }),
    })
  }, [api, bottomTab, fileFilter, fileQuery, selection, workspace.project, workspaceStateReady])

  function configureEditor(file: string) {
    const extension = file.includes('.') ? file.slice(file.lastIndexOf('.')) : ''
    const existing = editorAssociations.find((association) => association.pattern === `*${extension}` || association.pattern === file)
    setAssociationFile(file)
    setAssociationPattern(existing?.pattern ?? (extension ? `*${extension}` : file))
    setAssociationApplication(existing?.application ?? '')
    setAssociationError(null)
  }

  async function chooseEditor() {
    try {
      const selected = await api.selectExternalEditor()
      if (selected) setAssociationApplication(selected)
    } catch (reason: unknown) {
      setAssociationError(reason instanceof Error ? reason.message : 'Не удалось выбрать приложение')
    }
  }

  async function saveAssociation() {
    if (!associationPattern.trim() || !associationApplication.trim()) {
      setAssociationError('Укажите pattern и приложение')
      return
    }
    try {
      await api.saveEditorAssociation(associationPattern, associationApplication)
      setEditorAssociations(await api.editorAssociations())
      setAssociationFile(null)
      setAssociationError(null)
    } catch (reason: unknown) {
      setAssociationError(reason instanceof Error ? reason.message : 'Не удалось сохранить association')
    }
  }

  useEffect(() => {
    if (bottomTab !== 'reports') return
    setTrafficLoading(true)
    setTrafficError(null)
    void api.trafficRecords().then(setTraffic).catch((reason: unknown) => {
      setTrafficError(reason instanceof Error ? reason.message : 'Не удалось загрузить reports')
    }).finally(() => { setTrafficLoading(false) })
  }, [api, bottomTab])

  async function validateProject() {
    await runCLICommand(['validate'])
  }

  async function runCLICommand(args: string[]) {
    setCLIError(null)
    setCLIRunning(true)
    try {
      await api.runCLI(args)
    } catch (reason: unknown) {
      setCLIError(reason instanceof Error ? reason.message : 'CLI недоступен')
      setCLIRunning(false)
    }
  }

  async function prepareRemoteHandoff(target: string) {
    try {
      setRemoteHandoff(await api.prepareRemoteHandoff(target))
    } catch (reason: unknown) {
      setRemoteHandoff(reason instanceof Error ? reason.message : 'Remote handoff unavailable')
    }
  }

  const paletteCommands: Array<{ id: string; label: string; detail: string; run: () => void }> = [
    { id: 'validate', label: 'Validate project', detail: 'Run liapoldus validate', run: () => { setBottomTab('problems'); void validateProject() } },
    { id: 'cli', label: 'Open CLI output', detail: 'Show local Core and CLI actions', run: () => { setBottomTab('tools') } },
    { id: 'git', label: 'Open Git workspace', detail: 'Status, diff, history and sync', run: () => { setBottomTab('git') } },
    { id: 'reports', label: 'Open traffic reports', detail: 'Redacted CLI/Core observations', run: () => { setBottomTab('reports') } },
    { id: 'problems', label: 'Open Problems', detail: 'Diagnostics and validation state', run: () => { setBottomTab('problems') } },
    { id: 'home', label: 'Back to projects', detail: 'Leave the current project workspace', run: onHome },
  ]
  const filteredCommands = paletteCommands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(commandQuery.trim().toLowerCase()))

  useEffect(() => {
    function handlePaletteShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setCommandPaletteOpen(true)
        setCommandQuery('')
        setCommandIndex(0)
        return
      }
      if (event.key === 'Escape' && commandPaletteOpen) {
        event.preventDefault()
        setCommandPaletteOpen(false)
        return
      }
      if (!commandPaletteOpen || filteredCommands.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandIndex((current) => (current + 1) % filteredCommands.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        filteredCommands[commandIndex]?.run()
        setCommandPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', handlePaletteShortcut)
    return () => { window.removeEventListener('keydown', handlePaletteShortcut) }
  }, [commandPaletteOpen, commandIndex, filteredCommands])

  useEffect(() => {
    setCommandIndex((current) => Math.min(current, Math.max(filteredCommands.length - 1, 0)))
  }, [commandQuery, filteredCommands.length])

  return (
    <main className="project-shell">
      <header className="project-topbar">
        <button type="button" className="brand-button" onClick={onHome} aria-label="Вернуться к проектам">
          <span className="studio-mark studio-mark-small" aria-hidden="true">L</span>
          <span>{info?.name ?? 'Studio'}</span>
        </button>
        <div className="project-context">
          <strong>{workspace.project?.name}</strong>
          <span>{workspace.project?.rootPath}</span>
        </div>
        <div className="topbar-status">
          <span className={`status-dot ${!workspace.git.available ? 'status-neutral' : workspace.git.conflict || workspace.git.dirty ? 'status-warning' : 'status-success'}`} aria-hidden="true" />
          <span>{workspace.git.available ? workspace.git.branch || 'No branch' : 'Git unavailable'}</span>
          {workspace.git.available && workspace.git.revision && <span className="revision-chip">{workspace.git.revision}</span>}
            <span className={`topbar-chip ${workspace.git.conflict || workspace.git.dirty ? 'chip-warning' : ''}`}>{!workspace.git.available ? 'Unavailable' : workspace.git.conflict ? 'Conflict' : workspace.git.dirty ? 'Dirty' : 'Clean'}</span>
            <span className={`topbar-chip ${cliEvent?.type === 'run.failed' ? 'chip-warning' : ''}`}>CLI/Core {cliEvent?.state ?? (cliEvent?.type === 'run.completed' ? 'ready' : 'idle')}</span>
            <button type="button" className="command-palette-trigger" onClick={() => { setCommandPaletteOpen(true); setCommandQuery(''); setCommandIndex(0) }} aria-label="Open command palette">⌘P</button>
          </div>
      </header>

      <div className="project-body">
        <aside className="file-sidebar" aria-label="Project file tree">
          <div className="panel-heading">
            <span>Project files</span>
            <span className="muted-label">{workspace.files.length}</span>
          </div>
          <div className="file-tree-controls"><input aria-label="Search project files" placeholder="Search files…" value={fileQuery} onChange={(event) => { setFileQuery(event.target.value) }} /><select aria-label="Filter project files" value={fileFilter} onChange={(event) => { setFileFilter(event.target.value as typeof fileFilter) }}><option value="all">All files</option><option value="services">Services</option><option value="modules">Modules</option><option value="schemas">Schemas</option><option value="changed">Changed</option></select></div>
          <div className="file-tree" role="list">
            {visibleFiles.map((file) => (
              <div key={file.path} className="file-row" role="listitem">
                <button type="button" className="file-open-button" title={`Open ${file.path} externally`} onClick={() => { setFileError(null); void api.openFileExternally(file.path, '').catch((reason: unknown) => { setFileError(reason instanceof Error ? reason.message : 'Не удалось открыть файл') }) }}>
                  <span className={`file-icon file-icon-${file.kind}`} aria-hidden="true">·</span>
                  <span>{file.path}</span>
                </button>
                <button type="button" className="file-association-button" title={`Choose editor for ${file.path}`} aria-label={`Choose editor for ${file.path}`} onClick={() => { configureEditor(file.path) }}>⚙</button>
              </div>
            ))}
            {visibleFiles.length === 0 && <div className="empty-file-filter">No files match this filter.</div>}
            {fileError && <div className="file-tree-error" role="alert">{fileError}</div>}
            {associationFile && <div className="editor-association" role="dialog" aria-label="External editor association"><strong>Open externally</strong><span className="inspector-hint">{associationFile}</span><label>Pattern<input value={associationPattern} onChange={(event) => { setAssociationPattern(event.target.value) }} placeholder="*.yaml" /></label><label>Application<input value={associationApplication} onChange={(event) => { setAssociationApplication(event.target.value) }} placeholder="Choose an application" /></label><div className="editor-association-actions"><button type="button" className="secondary-button" onClick={() => { void chooseEditor() }}>Choose…</button><button type="button" className="secondary-button" onClick={() => { void saveAssociation() }}>Remember</button><button type="button" className="secondary-button" onClick={() => { setAssociationFile(null) }}>Cancel</button></div>{associationError && <span className="file-tree-error" role="alert">{associationError}</span>}</div>}
          </div>
        </aside>

        <section className="canvas-area" aria-label="Plugin graph">
          <div className="canvas-toolbar">
            <div>
              <p className="eyebrow">Configuration workspace</p>
              <h2>Plugin graph</h2>
            </div>
            <span className="topbar-chip">Local source</span>
          </div>
          <div className="canvas-empty">
            <div className="canvas-grid" aria-hidden="true" />
            {workspace.graph.plugins.length === 0 ? (
              <div className="canvas-empty-content">
                <span className="canvas-empty-icon" aria-hidden="true">+</span>
                <strong>Canvas готов к plugin graph</strong>
                <span>Когда project содержит services и links, здесь появятся runtime plugins и их связи.</span>
              </div>
            ) : (
              <div className="graph-content">
                <div className="graph-nodes" role="list" aria-label="Runtime plugins">
                  {workspace.graph.plugins.map((plugin) => (
                    <PluginNode
                      key={plugin.id}
                      plugin={plugin}
                      selected={selectedPlugin?.id === plugin.id}
                      onSelect={() => { setSelection({ kind: 'plugin', id: plugin.id }) }}
                    />
                  ))}
                </div>
                <div className="graph-links" role="list" aria-label="Plugin links">
                  {workspace.graph.links.length === 0 ? (
                    <span className="graph-no-links">Links пока не объявлены в Project</span>
                  ) : workspace.graph.links.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      className={`graph-link ${selectedLink?.id === link.id ? 'graph-link-selected' : ''}`}
                      onClick={() => { setSelection({ kind: 'link', id: link.id }) }}
                    >
                      <span>{link.caller} → {link.target}</span>
                      <small>{link.methods.length} methods · {link.transport || 'transport unknown'}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="inspector-sidebar" aria-label="Inspector">
          <div className="panel-heading"><span>Inspector</span><span className="muted-label">{selection ? selection.kind : 'No selection'}</span></div>
          {selectedPlugin && <PluginInspector api={api} plugin={selectedPlugin} />}
          {selectedLink && <LinkInspector api={api} link={selectedLink} />}
          {!selectedPlugin && !selectedLink && (
            <div className="inspector-empty">
              <strong>Выберите plugin или link</strong>
              <span>Настройки, schema и connection contract появятся здесь.</span>
            </div>
          )}
        </aside>
      </div>

      <section className="bottom-panel" aria-label="Tools and diagnostics">
        <div className="bottom-tabs" role="tablist" aria-label="Workspace tools">
          <button type="button" className={`bottom-tab ${bottomTab === 'problems' ? 'bottom-tab-active' : ''}`} role="tab" aria-selected={bottomTab === 'problems'} onClick={() => { setBottomTab('problems') }}>Problems <span>{String(workspace.git.changes.length + diagnostics.length)}</span></button>
          <button type="button" className={`bottom-tab ${bottomTab === 'cli' ? 'bottom-tab-active' : ''}`} role="tab" aria-selected={bottomTab === 'cli'} onClick={() => { setBottomTab('cli') }}>CLI output</button>
          <button type="button" className={`bottom-tab ${bottomTab === 'git' ? 'bottom-tab-active' : ''}`} role="tab" aria-selected={bottomTab === 'git'} onClick={() => { setBottomTab('git') }}>Git <span>{String(workspace.git.changes.length)}</span></button>
          <button type="button" className={`bottom-tab ${bottomTab === 'reports' ? 'bottom-tab-active' : ''}`} role="tab" aria-selected={bottomTab === 'reports'} onClick={() => { setBottomTab('reports') }}>Traffic reports <span>{traffic.length}</span></button>
          <button type="button" className={`bottom-tab ${bottomTab === 'tools' ? 'bottom-tab-active' : ''}`} role="tab" aria-selected={bottomTab === 'tools'} onClick={() => { setBottomTab('tools') }}>Studio tools</button>
        </div>
        {bottomTab === 'reports' ? <TrafficInspector api={api} records={traffic} loading={trafficLoading} error={trafficError} /> : bottomTab === 'git' ? <GitWorkspacePanel api={api} workspace={workspace} onWorkspaceChange={onWorkspaceChange} /> : (
          <div className="bottom-content">
            <span className={`status-dot ${cliEvent?.type === 'run.failed' ? 'status-warning' : 'status-success'}`} aria-hidden="true" />
            <span>{bottomTab === 'cli' && cliEvent ? `${cliEvent.type}${cliEvent.phase ? ` · ${cliEvent.phase}` : ''}${typeof cliEvent.percent === 'number' ? ` · ${String(cliEvent.percent)}%` : ''}${cliEvent.operationId ? ` · operation ${cliEvent.operationId}` : ''}${cliEvent.message ? ` · ${cliEvent.message}` : ''}` : bottomTab === 'tools' ? 'Installed declarative Studio tools will appear here.' : 'Project source открыт. Core observations появятся после CLI report.'}</span>
            {bottomTab === 'problems' && <button type="button" className="secondary-button bottom-action" disabled={cliRunning} onClick={() => { void validateProject() }}>{cliRunning ? 'Running…' : 'Validate project'}</button>}
          </div>
        )}
        {bottomTab === 'problems' && diagnostics.length > 0 && <div className="diagnostic-list" aria-label="Recovered diagnostics">{diagnostics.slice(-8).map((diagnostic, index) => <div className="diagnostic-row" key={`${diagnostic.code}-${diagnostic.timestamp}-${String(index)}`}><span className={`status-dot ${diagnostic.severity === 'error' ? 'status-warning' : 'status-neutral'}`} aria-hidden="true" /><span><strong>{diagnostic.code}</strong><small>{diagnostic.message} · {diagnostic.timestamp}</small></span></div>)}</div>}
        {bottomTab === 'tools' && <CLICommandPanel busy={cliRunning} events={cliEvents} targets={targets} runCommand={(args) => { void runCLICommand(args) }} cancelCommand={() => { void api.cancelCLI() }} prepareHandoff={(target) => { void prepareRemoteHandoff(target) }} handoff={remoteHandoff} />}
        {cliError && bottomTab !== 'reports' && <div className="bottom-error" role="alert">{cliError}</div>}
      </section>
      {commandPaletteOpen && <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandPaletteOpen(false) }}><section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title"><div className="command-palette-heading"><div><p className="eyebrow">Studio commands</p><h2 id="command-palette-title">Command palette</h2></div><kbd>Esc</kbd></div><input autoFocus aria-label="Search commands" placeholder="Search commands…" value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setCommandIndex(0) }} /><div className="command-palette-list" role="listbox" aria-label="Commands">{filteredCommands.length === 0 ? <div className="command-palette-empty">No commands match.</div> : filteredCommands.map((command, index) => <button type="button" role="option" aria-selected={index === commandIndex} className={`command-palette-item ${index === commandIndex ? 'command-palette-item-active' : ''}`} key={command.id} onMouseEnter={() => { setCommandIndex(index) }} onClick={() => { command.run(); setCommandPaletteOpen(false) }}><span><strong>{command.label}</strong><small>{command.detail}</small></span><kbd>{index === commandIndex ? '↵' : ''}</kbd></button>)}</div><div className="command-palette-hint">↑↓ navigate · Enter run · Esc close</div></section></div>}
    </main>
  )
}

function PluginNode({ plugin, selected, onSelect }: { plugin: RuntimePlugin; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`canvas-node ${selected ? 'canvas-node-selected' : ''}`} onClick={onSelect} role="listitem">
      <span className="canvas-node-kicker">Runtime plugin</span>
      <strong>{plugin.name}</strong>
      <span>{plugin.id} · v{plugin.version}</span>
      <span className="canvas-node-meta">
        <span className={`status-dot ${plugin.problemCount > 0 ? 'status-warning' : 'status-success'}`} aria-hidden="true" />
        {plugin.problemCount > 0 ? `${String(plugin.problemCount)} problems` : plugin.configured ? 'Configured' : 'Settings missing'}
      </span>
    </button>
  )
}

function PluginInspector({ api, plugin }: { api: StudioAPI; plugin: RuntimePlugin }) {
  return (
    <div className="inspector-content">
      <div className="inspector-title"><span className="eyebrow">Runtime plugin</span><h3>{plugin.name}</h3><code>{plugin.id}</code></div>
      <InspectorRow label="Version" value={plugin.version} />
      <InspectorRow label="Manifest schema" value={plugin.manifestVersion} />
      <InspectorRow label="Service" value={plugin.servicePath} />
      <InspectorRow label="Settings" value={plugin.settingsPath} />
      <InspectorRow label="Settings schema" value={plugin.settingsSchemaPath} />
      <InspectorRow label="Links" value={String(plugin.linkPaths.length)} />
      {plugin.problemCount > 0 && <div className="callout callout-warning">{plugin.problemCount} source problem(s) need attention.</div>}
      <PluginSettingsForm api={api} plugin={plugin} />
    </div>
  )
}

type Schema = {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  const?: unknown
  default?: unknown
  required?: string[]
  readOnly?: boolean
  properties?: Record<string, Schema>
  items?: Schema
  oneOf?: Schema[]
  anyOf?: Schema[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  ['x-sensitive']?: boolean
  ['x-secret']?: boolean
  ['x-redacted']?: boolean
}

function PluginSettingsForm({ api, plugin }: { api: StudioAPI; plugin: RuntimePlugin }) {
  const [schema, setSchema] = useState<Schema | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setMessage('')
    void Promise.all([
      api.readProjectSchema(plugin.settingsSchemaPath),
      api.readProjectSettings(plugin.settingsPath, plugin.settingsSchemaPath),
    ]).then(([schemaBytes, settingsBytes]) => {
      if (cancelled) return
      const nextSchema = JSON.parse(new TextDecoder().decode(schemaBytes)) as Schema
      const current = JSON.parse(new TextDecoder().decode(settingsBytes)) as unknown
      setSchema(nextSchema)
      setValues(buildInitialValues(nextSchema, current))
      setState('ready')
    }).catch((reason: unknown) => {
      if (cancelled) return
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось загрузить settings schema')
    })
    return () => { cancelled = true }
  }, [api, plugin.id, plugin.settingsPath, plugin.settingsSchemaPath])

  async function save() {
    if (!schema) return
    setState('saving')
    setMessage('')
    try {
      const patch = new TextEncoder().encode(JSON.stringify(values))
      await api.writeProjectSettings(plugin.settingsPath, plugin.settingsSchemaPath, patch)
      setState('saved')
      setMessage('Сохранено в canonical Project')
    } catch (reason: unknown) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить settings')
    }
  }

  return (
    <section className="settings-editor" aria-label={`${plugin.name} settings`}>
      <div className="inspector-section-heading">
        <div><span className="eyebrow">Schema-driven settings</span><strong>{schema?.title ?? 'Configuration'}</strong></div>
        {state === 'ready' || state === 'saved' ? <button type="button" className="secondary-button settings-save" onClick={() => { void save() }}>Save</button> : null}
      </div>
      {state === 'loading' && <span className="inspector-hint">Loading schema…</span>}
      {state === 'error' && <div className="callout callout-error">{message}</div>}
      {schema?.description && <p className="inspector-hint">{schema.description}</p>}
      {schema && state !== 'error' && <SchemaObjectForm schema={schema} value={values} onChange={setValues} />}
      {message && state === 'saved' && <div className="callout callout-success">{message}</div>}
    </section>
  )
}

function SchemaObjectForm({ schema, value, onChange, path = [] }: { schema: Schema; value: unknown; onChange: (value: Record<string, unknown>) => void; path?: string[] }) {
  const object = isRecord(value) ? value : {}
  return <div className="schema-form">{Object.entries(schema.properties ?? {}).map(([key, child]) => (
    <SchemaField key={key} name={key} schema={child} value={object[key]} required={schema.required?.includes(key) === true} onChange={(next) => { onChange({ ...object, [key]: next }) }} path={[...path, key]} />
  ))}</div>
}

function SchemaField({ name, schema, value, onChange, path, required = false }: { name: string; schema: Schema; value: unknown; onChange: (value: unknown) => void; path: string[]; required?: boolean }) {
  const sensitive = isSensitive(schema, name)
  const label = schema.title ?? name
  const variants = schema.oneOf ?? schema.anyOf
  if (variants?.length) {
    const selected = variants.find((variant) => matchesSchemaValue(variant, value)) ?? variants[0]
    return <SchemaField name={name} schema={selected} value={value} onChange={onChange} path={path} required={required} />
  }
  if (schema.type === 'object' || schema.properties) {
    return <fieldset className="schema-object"><legend>{label}{required && <span className="field-required" aria-label="required">*</span>}</legend>{schema.description && <span className="inspector-hint">{schema.description}</span>}<SchemaObjectForm schema={schema} value={value} onChange={(next) => { onChange(next) }} path={path} /></fieldset>
  }
  if (sensitive || schema.readOnly) {
    return <div className="schema-field"><label>{label}{required && <span className="field-required" aria-label="required">*</span>}<span className="field-badge">managed externally</span></label><div className="managed-value">{sensitive ? 'Secret is hidden and remains owned by CLI or an external editor.' : 'This value is read-only and remains owned by the project or CLI.'}</div></div>
  }
  const common = { id: `setting-${path.join('-')}` }
  if (schema.enum) {
    const selected = schema.enum.findIndex((option) => Object.is(option, value))
    return <div className="schema-field"><label htmlFor={common.id}>{label}{required && <span className="field-required" aria-label="required">*</span>}</label><select {...common} value={selected >= 0 ? String(selected) : ''} onChange={(event) => { const index = Number(event.target.value); onChange(schema.enum?.[index]) }}><option value="">Select…</option>{schema.enum.map((option, index) => <option key={`${displayValue(option)}-${String(index)}`} value={String(index)}>{displayValue(option)}</option>)}</select>{schema.description && <span className="field-help">{schema.description}</span>}</div>
  }
  if (schema.type === 'boolean') {
    return <label className="schema-checkbox"><input type="checkbox" checked={value === true} onChange={(event) => { onChange(event.target.checked) }} />{label}{required && <span className="field-required" aria-label="required">*</span>}</label>
  }
  if (schema.type === 'array') {
    return <SchemaArrayField name={label} schema={schema} value={value} onChange={onChange} path={path} required={required} />
  }
  const numeric = schema.type === 'number' || schema.type === 'integer'
  return <div className="schema-field"><label htmlFor={common.id}>{label}{required && <span className="field-required" aria-label="required">*</span>}</label><input {...common} type={numeric ? 'number' : 'text'} value={displayValue(value)} onChange={(event) => { onChange(numeric ? Number(event.target.value) : event.target.value) }} />{schema.description && <span className="field-help">{schema.description}</span>}</div>
}

function SchemaArrayField({ name, schema, value, onChange, path, required }: { name: string; schema: Schema; value: unknown; onChange: (value: unknown) => void; path: string[]; required: boolean }) {
  const items: unknown[] = Array.isArray(value) ? value as unknown[] : []
  const itemSchema = schema.items ?? { type: 'string' }
  return <div className="schema-field schema-array-field"><label>{name}{required && <span className="field-required" aria-label="required">*</span>}</label>{schema.description && <span className="field-help">{schema.description}</span>}<div className="schema-array-items">{items.map((item, index) => <div className="schema-array-item" key={`${path.join('-')}-${String(index)}`}><SchemaField name={`${name} ${String(index + 1)}`} schema={itemSchema} value={item} onChange={(next) => { const updated = [...items]; updated[index] = next; onChange(updated) }} path={[...path, String(index)]} /><button type="button" className="surface-link" onClick={() => { onChange(items.filter((_, itemIndex) => itemIndex !== index)) }}>Remove</button></div>)}</div><button type="button" className="secondary-button" onClick={() => { onChange([...items, defaultSchemaValue(itemSchema)]) }}>Add item</button></div>
}

function displayValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function buildInitialValues(schema: Schema, value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {}
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key]
    else if (child.default !== undefined && !isSensitive(child, key)) result[key] = child.default
    else if (child.type === 'object' || child.properties) result[key] = buildInitialValues(child, {})
    else if (child.type === 'array') result[key] = []
  }
  return result
}

function defaultSchemaValue(schema: Schema): unknown {
  if (schema.default !== undefined && !isSensitive(schema, '')) return schema.default
  if (schema.const !== undefined && !isSensitive(schema, '')) return schema.const
  if (schema.type === 'object' || schema.properties) return buildInitialValues(schema, {})
  if (schema.type === 'array') return []
  if (schema.type === 'boolean') return false
  if (schema.type === 'number' || schema.type === 'integer') return 0
  return ''
}

function matchesSchemaValue(schema: Schema, value: unknown): boolean {
  if (schema.const !== undefined) return Object.is(schema.const, value)
  if (schema.enum) return schema.enum.some((option) => Object.is(option, value))
  if (!schema.type) return true
  if (schema.type === 'object') return isRecord(value)
  if (schema.type === 'array') return Array.isArray(value)
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number'
  if (schema.type === 'null') return value === null
  return typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSensitive(schema: Schema, name: string) {
  const lower = name.toLowerCase()
  return schema['x-sensitive'] === true || schema['x-secret'] === true || schema['x-redacted'] === true || ['secret', 'token', 'password', 'privatekey', 'authorization'].some((marker) => lower.includes(marker))
}

function LinkInspector({ api, link }: { api: StudioAPI; link: PluginLink }) {
  return (
    <div className="inspector-content">
      <div className="inspector-title"><span className="eyebrow">Plugin link</span><h3>{link.caller} → {link.target}</h3><code>{link.id}</code></div>
      <InspectorRow label="Contract" value={link.contractVersion || 'Not declared'} />
      <InspectorRow label="Transport" value={link.transport || 'Not declared'} />
      <InspectorRow label="Methods" value={link.methods.length ? link.methods.join(', ') : 'Not declared'} />
      <InspectorRow label="Request schema" value={link.requestSchemaPath || 'Not declared'} />
      <InspectorRow label="Response schema" value={link.responseSchemaPath || 'Not declared'} />
      <InspectorRow label="Security" value={link.securityProfile || 'Not declared'} />
      <InspectorRow label="Limits" value={`${String(link.timeoutMillis || 0)}ms · ${String(link.retryLimit || 0)} retries · ${String(link.requestLimitBytes || 0)}/${String(link.responseLimitBytes || 0)} bytes`} />
      <InspectorRow label="Compatibility" value={link.compatibility || 'Not declared'} />
      <InspectorRow label="Redaction" value={link.redactionPolicy || 'Not declared'} />
      <InspectorRow label="Source" value={link.sourcePath} />
      <div className={`contract-state ${link.valid ? 'contract-valid' : 'contract-invalid'}`}>{link.valid ? 'Valid source contract' : 'Invalid source contract'}</div>
      <span className="inspector-hint">Request/response schemas, security profile, limits and redaction policy are owned by this versioned contract.</span>
      <PluginContractForm api={api} link={link} />
    </div>
  )
}

function PluginContractForm({ api, link }: { api: StudioAPI; link: PluginLink }) {
  const [schema, setSchema] = useState<Schema | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!link.contractSchemaPath) {
      setSchema(null)
      setValues({})
      setState('idle')
      setMessage('')
      return () => { cancelled = true }
    }
    setState('loading')
    setMessage('')
    void Promise.all([
      api.readProjectSchema(link.contractSchemaPath),
      api.readProjectSettings(link.sourcePath, link.contractSchemaPath),
    ]).then(([schemaBytes, contractBytes]) => {
      if (cancelled) return
      const nextSchema = JSON.parse(new TextDecoder().decode(schemaBytes)) as Schema
      const current = JSON.parse(new TextDecoder().decode(contractBytes)) as unknown
      setSchema(nextSchema)
      setValues(buildInitialValues(nextSchema, current))
      setState('ready')
    }).catch((reason: unknown) => {
      if (cancelled) return
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось загрузить contract schema')
    })
    return () => { cancelled = true }
  }, [api, link.id, link.contractSchemaPath, link.sourcePath])

  async function save() {
    if (!schema) return
    setState('saving')
    setMessage('')
    try {
      await api.writeProjectSettings(link.sourcePath, link.contractSchemaPath, new TextEncoder().encode(JSON.stringify(values)))
      setState('saved')
      setMessage('Contract сохранён в canonical Project')
    } catch (reason: unknown) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить contract')
    }
  }

  return (
    <section className="settings-editor" aria-label={`${link.id} contract`}>
      <div className="inspector-section-heading">
        <div><span className="eyebrow">Schema-driven contract</span><strong>{schema?.title ?? 'Connection contract'}</strong></div>
        {(state === 'ready' || state === 'saved') && <button type="button" className="secondary-button settings-save" onClick={() => { void save() }}>Save</button>}
      </div>
      {!link.contractSchemaPath && <span className="inspector-hint">Contract schema не объявлена в link source.</span>}
      {state === 'loading' && <span className="inspector-hint">Loading contract schema…</span>}
      {state === 'error' && <div className="callout callout-error">{message}</div>}
      {schema?.description && <p className="inspector-hint">{schema.description}</p>}
      {schema && state !== 'error' && <SchemaObjectForm schema={schema} value={values} onChange={setValues} />}
      {message && state === 'saved' && <div className="callout callout-success">{message}</div>}
    </section>
  )
}

function TrafficInspector({ api, records, loading, error }: { api: StudioAPI; records: TrafficRecordView[]; loading: boolean; error: string | null }) {
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [transportFilter, setTransportFilter] = useState('all')
  const [minLatency, setMinLatency] = useState('')
  const [maxLatency, setMaxLatency] = useState('')
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')
  const [view, setView] = useState<'table' | 'timeline'>('table')
  const [exportState, setExportState] = useState('')
  const statuses = Array.from(new Set(records.map((record) => record.status).filter(Boolean))).sort()
  const transports = Array.from(new Set(records.map((record) => record.transport).filter(Boolean))).sort()
  const visible = records.filter((record) => {
    const query = filter.trim().toLowerCase()
    const matchesQuery = !query || [record.caller, record.target, record.method, record.status, record.reportTarget].some((value) => value.toLowerCase().includes(query))
    const matchesStatus = statusFilter === 'all' || record.status === statusFilter
    const matchesTransport = transportFilter === 'all' || record.transport === transportFilter
    const minimum = minLatency === '' ? 0 : Number(minLatency)
    const maximum = maxLatency === '' ? Number.POSITIVE_INFINITY : Number(maxLatency)
    const matchesLatency = Number.isFinite(minimum) && Number.isFinite(maximum) && record.latencyMillis >= minimum && record.latencyMillis <= maximum
    const timestamp = Date.parse(record.timestamp)
    const from = fromTime === '' ? Number.NEGATIVE_INFINITY : Date.parse(fromTime)
    const to = toTime === '' ? Number.POSITIVE_INFINITY : Date.parse(toTime)
    const matchesTime = fromTime === '' && toTime === '' || Number.isFinite(timestamp) && Number.isFinite(from) && Number.isFinite(to) && timestamp >= from && timestamp <= to
    return matchesQuery && matchesStatus && matchesTransport && matchesLatency && matchesTime
  })
  if (loading) return <div className="traffic-state">Loading redacted traffic reports…</div>
  if (error) return <div className="traffic-state traffic-state-error">{error}</div>
  return (
    <div className="traffic-panel">
      <div className="traffic-toolbar"><span className="inspector-hint">Report-based observations · secrets are redacted before persistence</span><input aria-label="Filter traffic" placeholder="Filter plugin, method, report…" value={filter} onChange={(event) => { setFilter(event.target.value) }} /><select aria-label="Filter traffic status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value) }}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Filter traffic transport" value={transportFilter} onChange={(event) => { setTransportFilter(event.target.value) }}><option value="all">All transports</option>{transports.map((transport) => <option key={transport} value={transport}>{transport}</option>)}</select><input aria-label="Minimum latency" type="number" min="0" placeholder="Min ms" value={minLatency} onChange={(event) => { setMinLatency(event.target.value) }} /><input aria-label="Maximum latency" type="number" min="0" placeholder="Max ms" value={maxLatency} onChange={(event) => { setMaxLatency(event.target.value) }} /><input aria-label="Traffic from time" type="datetime-local" value={fromTime} onChange={(event) => { setFromTime(event.target.value) }} /><input aria-label="Traffic to time" type="datetime-local" value={toTime} onChange={(event) => { setToTime(event.target.value) }} /><button type="button" className={`secondary-button ${view === 'table' ? 'view-button-active' : ''}`} onClick={() => { setView('table') }}>Table</button><button type="button" className={`secondary-button ${view === 'timeline' ? 'view-button-active' : ''}`} onClick={() => { setView('timeline') }}>Timeline</button><button type="button" className="secondary-button" onClick={() => { void api.exportTrafficReport().then((path) => { if (path) setExportState(`Exported: ${path}`) }).catch((reason: unknown) => { setExportState(reason instanceof Error ? reason.message : 'Export failed') }) }}>Export safe JSON</button></div>
      {exportState && <div className="inspector-hint" role="status">{exportState}</div>}
      {visible.length === 0 ? <div className="traffic-state">No traffic records match the current filters.</div> : view === 'timeline' ? (
        <div className="traffic-timeline" aria-label="Traffic timeline">{visible.map((record, index) => <article className="traffic-event" key={`${record.correlationId}-timeline-${String(index)}`}><time>{record.timestamp || 'Unknown time'}</time><div className="traffic-event-marker" aria-hidden="true" /><div className="traffic-event-body"><strong>{record.caller} → {record.target}</strong><span>{record.method} · {record.transport || 'unknown transport'} · {String(record.latencyMillis)} ms</span><span className={`traffic-status traffic-status-${record.status.toLowerCase()}`}>{record.status || 'unknown'} · {record.schemaValidation || 'schema unknown'}</span></div></article>)}</div>
      ) : (
        <div className="traffic-table-wrap"><table className="traffic-table"><caption>{String(visible.length)} of {String(records.length)} redacted records</caption><thead><tr><th>Time</th><th>Route</th><th>Method</th><th>Status</th><th>Schema</th><th>Latency</th><th>Provenance</th><th>Payloads</th></tr></thead><tbody>{visible.map((record, index) => <tr key={`${record.correlationId}-${String(index)}`}><td>{record.timestamp || '—'}</td><td>{record.caller} → {record.target}</td><td>{record.method}</td><td><span className={`traffic-status traffic-status-${record.status.toLowerCase()}`}>{record.status || 'unknown'}</span></td><td>{record.schemaValidation || '—'}</td><td>{String(record.latencyMillis)} ms</td><td>{record.reportTarget || '—'} · {record.reportCommitSha || '—'}</td><td><details><summary>View</summary><div className="payload-grid"><pre>{record.requestPayload || 'null'}</pre><pre>{record.responsePayload || 'null'}</pre></div></details></td></tr>)}</tbody></table></div>
      )}
    </div>
  )
}

function GitWorkspacePanel({ api, workspace, onWorkspaceChange }: { api: StudioAPI; workspace: Workspace; onWorkspaceChange: (workspace: Workspace) => void }) {
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [selectedPath, setSelectedPath] = useState(workspace.git.changes[0]?.path ?? '')
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [history, setHistory] = useState<GitCommit[]>([])
  const [remotes, setRemotes] = useState<GitRemote[]>([])
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!workspace.git.available) return
    void Promise.all([api.gitBranches(), api.gitHistory(20), api.gitRemotes()]).then(([nextBranches, nextHistory, nextRemotes]) => { setBranches(nextBranches); setHistory(nextHistory); setRemotes(nextRemotes) }).catch((reason: unknown) => { setStatus(reason instanceof Error ? reason.message : 'Не удалось загрузить Git metadata') })
  }, [api, workspace.git.available, workspace.git.revision])

  async function refresh() {
    try {
      onWorkspaceChange(await api.workspace())
      setStatus('Git status updated')
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : 'Не удалось обновить Git status')
    }
  }

  async function showDiff(path: string) {
    setSelectedPath(path)
    try {
      setDiff(await api.gitDiff(path))
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : 'Не удалось загрузить diff')
    }
  }

  async function commit() {
    if (!message.trim() || workspace.git.changes.length === 0) return
    try {
      await api.gitCommit(message.trim(), workspace.git.changes.map((change) => change.path), window.confirm('Commit all listed project changes?'))
      setMessage('')
      await refresh()
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : 'Commit failed')
    }
  }

  async function sync(kind: 'pull' | 'push') {
    const branch = workspace.git.branch
    if (!branch || !window.confirm(`${kind === 'pull' ? 'Pull' : 'Push'} ${branch} using native git?`)) return
    try {
      if (kind === 'pull') await api.gitPull('origin', branch, true)
      else await api.gitPush('origin', branch, true)
      await refresh()
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : `${kind} failed`)
    }
  }

  async function checkout(branch: string) {
    if (!branch || branch === workspace.git.branch || !window.confirm(`Switch to ${branch}? The working tree must be clean.`)) return
    try {
      await api.gitCheckout(branch, true)
      onWorkspaceChange(await api.workspace())
      setDiff(null)
    } catch (reason: unknown) {
      setStatus(reason instanceof Error ? reason.message : 'Branch switch failed')
    }
  }

  return <div className="git-panel">
    <div className="git-toolbar"><span className="inspector-hint">Native Git boundary · credentials remain owned by Git helpers</span><button type="button" className="secondary-button" onClick={() => { void refresh() }}>Refresh</button><button type="button" className="secondary-button" disabled={!workspace.git.branch} onClick={() => { void sync('pull') }}>Pull</button><button type="button" className="secondary-button" disabled={!workspace.git.branch} onClick={() => { void sync('push') }}>Push</button></div>
    {status && <div className="inspector-hint" role="status">{status}</div>}
    {!workspace.git.available ? <div className="traffic-state">Git is unavailable for this project.</div> : <>
      <div className="git-summary"><label>Branch<select aria-label="Git branch" value={workspace.git.branch} disabled={workspace.git.dirty || workspace.git.conflict} onChange={(event) => { void checkout(event.target.value) }}>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.remote ? ` · ${branch.remote}` : ''}</option>)}</select></label><span>{workspace.git.revision || 'No revision'}</span><span>{remotes.length ? remotes.map((remote) => `${remote.name}: ${remote.fetchUrl}`).join(' · ') : 'No remotes'}</span></div>
      {workspace.git.conflict && <div className="callout callout-error">Conflict state detected. Resolve files in an external Git tool before commit/pull/push.</div>}
      <div className="git-changes"><div className="git-change-list">{workspace.git.changes.length === 0 ? <span className="inspector-hint">Working tree clean.</span> : workspace.git.changes.map((change) => <button type="button" key={change.path} className={`git-change-row ${selectedPath === change.path ? 'git-change-selected' : ''}`} onClick={() => { void showDiff(change.path) }}><span>{change.path}</span><small>{change.indexStatus}/{change.worktreeStatus}</small></button>)}</div><div className="git-diff"><pre>{diff?.patch ?? 'Select a changed file to inspect its bounded diff.'}</pre>{diff?.truncated && <span className="inspector-hint">Diff truncated at the safety limit.</span>}</div></div>
      <div className="git-commit"><input aria-label="Commit message" placeholder="Commit message" value={message} onChange={(event) => { setMessage(event.target.value) }} /><button type="button" className="primary-button" disabled={!message.trim() || workspace.git.changes.length === 0 || workspace.git.conflict} onClick={() => { void commit() }}>Commit all changes</button></div>
      <section className="git-history" aria-label="Git commit history"><strong>Recent commits</strong>{history.length === 0 ? <span className="inspector-hint">No commits.</span> : history.map((commit) => <article className="git-history-row" key={commit.hash}><code>{commit.shortHash}</code><span>{commit.subject}</span><small>{commit.author} · {commit.timestamp}</small></article>)}</section>
    </>}
  </div>
}

type TargetSnapshot = { name: string; state: string }

function mergeTargetEvent(current: TargetSnapshot[], event: CLIEvent): TargetSnapshot[] {
  const fromPayload = extractTargets(event.payload)
  const updates = fromPayload.length > 0 ? fromPayload : event.target && event.type.startsWith('target.') ? [{ name: event.target, state: event.state ?? 'available' }] : []
  const result = [...current]
  for (const update of updates) {
    const index = result.findIndex((target) => target.name === update.name)
    if (index >= 0) result[index] = update
    else result.push(update)
  }
  return result.slice(-20)
}

function extractTargets(payload: unknown): TargetSnapshot[] {
  const values = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.targets) ? payload.targets : []
  return values.flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== 'string') return []
    return [{ name: value.name, state: typeof value.state === 'string' ? value.state : 'available' }]
  })
}

function CLICommandPanel({ busy, events, targets, runCommand, cancelCommand, prepareHandoff, handoff }: { busy: boolean; events: CLIEvent[]; targets: TargetSnapshot[]; runCommand: (args: string[]) => void; cancelCommand: () => void; prepareHandoff: (target: string) => void; handoff: string }) {
  const [target, setTarget] = useState('production')
  const [operationId, setOperationId] = useState('')
  const localCoreArgs = (action: string): string[] => ['core', action, '--target', 'local']
  return <div className="cli-command-panel"><span className="inspector-hint">Local target and Core lifecycle are owned by `liapoldus`; Studio only presents the typed CLI events.</span>{targets.length > 0 && <div className="target-catalog" aria-label="CLI target catalog">{targets.map((item) => <button type="button" className="target-chip" key={item.name} onClick={() => { setTarget(item.name) }}>{item.name} · {item.state}</button>)}</div>}<div className="cli-command-grid"><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(['target', 'list']) }}>Targets</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(['target', 'inspect', 'local']) }}>Inspect local</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(localCoreArgs('status')) }}>Core status</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(localCoreArgs('logs')) }}>Core logs</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(localCoreArgs('start')) }}>Start local Core</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(localCoreArgs('stop')) }}>Stop local Core</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(localCoreArgs('restart')) }}>Restart local Core</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(['plan', '--target', 'local']) }}>Plan local</button><button type="button" className="secondary-button" disabled={busy || !operationId.trim()} onClick={() => { runCommand(['operation', 'watch', operationId.trim(), '--target', 'local']) }}>Watch operation</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { runCommand(['observe', 'traffic', '--target', 'local']) }}>Observe traffic</button><button type="button" className="secondary-button cli-danger-action" disabled={busy} onClick={() => { if (window.confirm('Run local apply through liapoldus CLI?')) runCommand(['apply', '--target', 'local', '--confirm']) }}>Apply local…</button>{busy && <button type="button" className="secondary-button cli-cancel-button" onClick={cancelCommand}>Cancel CLI run</button>}</div><div className="handoff-row"><input aria-label="Operation ID" placeholder="Operation ID" value={operationId} onChange={(event) => { setOperationId(event.target.value) }} /><input aria-label="Remote target" value={target} onChange={(event) => { setTarget(event.target.value) }} /><button type="button" className="secondary-button" disabled={busy || !target.trim()} onClick={() => { prepareHandoff(target.trim()) }}>Prepare remote handoff</button></div>{handoff && <pre className="handoff-preview">{handoff}</pre>}{events.length > 0 && <div className="cli-event-log" aria-label="CLI event history">{events.slice(-8).map((event, index) => <div className="cli-event-row" key={`${event.type}-${event.operationId ?? ''}-${String(index)}`}><span className={`status-dot ${event.severity === 'error' || event.type === 'run.failed' ? 'status-warning' : 'status-success'}`} aria-hidden="true" /><span>{event.type}{event.phase ? ` · ${event.phase}` : ''}{event.percent !== undefined ? ` · ${String(event.percent)}%` : ''}{event.operationId ? ` · ${event.operationId}` : ''}{event.target ? ` · ${event.target}` : ''}{event.state ? ` · ${event.state}` : ''}</span></div>)}</div>}</div>
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return <div className="inspector-row"><span>{label}</span><strong title={value}>{value}</strong></div>
}

export default App
