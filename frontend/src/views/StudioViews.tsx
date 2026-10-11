import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, MiniMap, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { EdgeChange, NodeChange } from '@xyflow/react'
import { Activity, Boxes, Check, CircleAlert, CircleDot, File, FolderOpen, GitBranch, GitCompareArrows, Home as HomeIcon, Moon, MoreHorizontal, Play, Plus, Puzzle, RefreshCw, Save, Search, Settings, Sun, Terminal, Trash2, X, Zap, PackageCheck, Container, ListChecks } from 'lucide-react'
import type { ArtifactReference, CLIEvent, Diagnostic, GitChange, RuntimePlugin, ThemePreference, ToolchainStatus, TrafficRecordView, Workspace } from '../api/types'
import type { StudioController } from '../controllers/studioController'
import { text, type Copy } from '../models/copy'
import { summarizeCLIEvent, type Document, type DockPanel, type Locale, type NavItem } from '../models/studio'
import { useStudioStore } from '../stores/studio'

export function ActivityBar({ screen, t, onNavigate }: { screen: NavItem; t: Copy; onNavigate: (item: NavItem) => void }) { const entries: Array<[NavItem, typeof HomeIcon, string]> = [['home', HomeIcon, t.home], ['graph', Boxes, t.graph], ['files', File, t.files], ['git', GitCompareArrows, t.git], ['reports', Activity, t.reports], ['plugins', Puzzle, t.plugins], ['artifacts', PackageCheck, t.artifacts], ['runtime', Container, t.runtime], ['settings', Settings, t.settings]]; return <nav className="activity-bar" aria-label="Navigation">{entries.map(([id, Icon, label]) => <button key={id} className={`activity-button ${screen === id ? 'active' : ''}`} title={label} onClick={() => { onNavigate(id); }}><Icon size={18} /></button>)}</nav> }

export function HomeView({ controller, locale, theme, projects, toolchain, error, onOpen, onCreate, onOpenProject }: { controller: StudioController; locale: Locale; theme: ThemePreference; projects: Array<{ rootPath: string; name: string }>; toolchain: ToolchainStatus | null; error: string | null; onOpen: () => void; onCreate: () => void; onOpenProject: (root: string) => void }) { const t = text[locale]; return <div className="home-screen"><div className="home-hero"><div className="brand-mark large">L</div><span className="eyebrow">Liapoldus Studio</span><h1>Build with clarity.</h1><p>Desktop workbench for CLI projects, runtime plugins and local Core workflows.</p><div className="home-actions"><button className="primary-button" onClick={onOpen}><FolderOpen size={16} />{t.open}</button><button className="secondary-button" onClick={onCreate}><Plus size={16} />{t.create}</button></div>{error && <div className="home-error"><CircleAlert size={15} />{error}</div>}</div><div className="home-grid"><section className="home-card"><div className="card-heading"><span>{t.recent}</span><span className="status-dot" /></div>{projects.length === 0 ? <span className="muted">{t.noProjects}</span> : projects.slice(0, 8).map((project) => <button className="recent-project" key={project.rootPath} onClick={() => { onOpenProject(project.rootPath); }}><span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small>{project.rootPath}</small></span><span>›</span></button>)}</section><section className="home-card"><div className="card-heading"><span>Environment</span><Terminal size={15} /></div><div className="environment-row"><span>CLI</span><strong className={toolchain?.cliAvailable ? 'text-success' : 'text-warning'}>{toolchain?.cliAvailable ? toolchain.cliVersion || 'available' : t.cliMissing}</strong></div><div className="environment-row"><span>Desktop</span><strong>Wails · React</strong></div><div className="home-settings"><button className="segmented-button" onClick={() => void controller.setLocale('ru')}>RU</button><button className="segmented-button" onClick={() => void controller.setLocale('en')}>EN</button><button className={`segmented-button ${theme === 'dark' ? 'active' : ''}`} onClick={() => void controller.setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button></div></section></div></div> }

export function FilesSidebar({ workspace, t, controller }: { workspace: Workspace; t: Copy; controller: StudioController }) { const query = useStudioStore((state) => state.query); const setField = useStudioStore((state) => state.setField); const files = workspace.files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())); return <aside className="context-sidebar"><div className="sidebar-heading"><span>{t.files}</span><span className="count">{files.length}</span></div><div className="search-box"><Search size={14} /><input value={query} onChange={(event) => { setField('query', event.target.value); }} placeholder="Search" /></div><div className="file-list">{files.map((file) => <button className="file-item" key={file.path} onClick={() => void controller.openFile(file)}><File size={14} /><span>{file.path}</span></button>)}</div></aside> }

export function PluginsSidebar({ workspace, t }: { workspace: Workspace; t: Copy }) { const setPluginOpen = useStudioStore((state) => state.setPluginOpen); const setSelected = useStudioStore((state) => state.setSelected); const navigate = useStudioStore((state) => state.navigate); return <aside className="context-sidebar"><div className="sidebar-heading"><span>{t.plugins}</span><button className="icon-button small" title={t.newPlugin} onClick={() => { setPluginOpen(true); }}><Plus size={15} /></button></div><div className="sidebar-list">{workspace.graph.plugins.map((plugin) => <button className="list-row" key={plugin.id} onClick={() => { setSelected({ kind: 'plugin', id: plugin.id }); navigate('graph') }}><Boxes size={14} /><span>{plugin.name}</span><small>{plugin.version}</small></button>)}</div></aside> }

export function GraphView({ controller, workspace, t }: { controller: StudioController; workspace: Workspace; t: Copy }) { const layout = useStudioStore((state) => state.layout); const nodes = useStudioStore((state) => state.canvasNodes); const edges = useStudioStore((state) => state.canvasEdges); const setCanvasNodes = useStudioStore((state) => state.setCanvasNodes); const setCanvasEdges = useStudioStore((state) => state.setCanvasEdges); const setSelected = useStudioStore((state) => state.setSelected); const setPluginOpen = useStudioStore((state) => state.setPluginOpen); const navigate = useStudioStore((state) => state.navigate); const pluginKey = workspace.graph.plugins.map((plugin) => plugin.id).join('\u0000'); useEffect(() => { setCanvasNodes(workspace.graph.plugins.map((plugin, index) => ({ id: plugin.id, type: 'plugin', position: layout[plugin.id] ?? { x: 80 + (index % 3) * 260, y: 80 + Math.floor(index / 3) * 170 }, data: { plugin } }))); setCanvasEdges(workspace.graph.links.map((link) => ({ id: link.id, source: link.caller, target: link.target, label: link.methods.join(', '), animated: link.valid, type: 'smoothstep' }))) }, [workspace.graph, layout, setCanvasNodes, setCanvasEdges]); useEffect(() => { void controller.refreshRuntimeStatuses() }, [controller, workspace.project?.id, pluginKey]); function onNodesChange(changes: NodeChange[]) { setCanvasNodes(applyNodeChanges(changes, useStudioStore.getState().canvasNodes)) } function onEdgesChange(changes: EdgeChange[]) { setCanvasEdges(applyEdgeChanges(changes, useStudioStore.getState().canvasEdges)) } return <section className="graph-workspace"><div className="workspace-toolbar"><div><span className="eyebrow">{t.graph}</span><h1>{workspace.graph.plugins.length} plugins <span className="toolbar-muted">· {workspace.graph.links.length} links</span></h1></div><div className="toolbar-actions"><span className="runtime-chip">Runtime · CLI</span><button className="icon-button" title="Refresh" onClick={() => void controller.refreshGraph()}><RefreshCw size={16} /></button><button className="secondary-button compact" onClick={() => { setPluginOpen(true); }}><Plus size={15} />{t.newPlugin}</button><button className="secondary-button compact" onClick={() => { navigate('artifacts') }}><PackageCheck size={15} />{t.artifacts}</button></div></div><div className="flow-wrap">{workspace.graph.plugins.length === 0 ? <div className="graph-empty"><div className="empty-orbit"><Boxes size={24} /></div><strong>{t.emptyGraph}</strong><span>services/&lt;plugin&gt; and links are canonical project files.</span><div className="empty-actions"><button className="primary-button compact" onClick={() => { setPluginOpen(true); }}><Plus size={15} />{t.newPlugin}</button><button className="secondary-button compact" onClick={() => { navigate('artifacts') }}><PackageCheck size={15} />{t.artifacts}</button></div></div> : <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ plugin: PluginFlowNode }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={(connection) => void controller.createLink(connection)} onNodesDelete={(deleted) => void controller.deleteNodes(deleted.map((node) => node.id))} onEdgesDelete={(deleted) => void controller.deleteEdges(deleted.map((edge) => edge.id))} onNodeDragStop={(_, node) => void controller.persistNodePosition(node.id, node.position)} onNodeClick={(_, node) => { setSelected({ kind: 'plugin', id: node.id }); }} onEdgeClick={(_, edge) => { setSelected({ kind: 'link', id: edge.id }); }} fitView deleteKeyCode="Delete" selectionOnDrag panOnDrag><Background gap={24} size={1} color="var(--grid)" /><MiniMap pannable zoomable nodeColor="var(--accent)" /><Controls showInteractive={false} /></ReactFlow>}</div></section> }
function PluginFlowNode({ data, selected }: { data: { plugin: RuntimePlugin }; selected?: boolean }) { const plugin = data.plugin; const readiness = useStudioStore((state) => state.runtimeStatuses[plugin.id] ?? 'unknown'); const locale = useStudioStore((state) => state.locale); const t = text[locale]; const labels = { ready: t.runtimeReady, 'not-ready': t.runtimeNotReady, unknown: t.runtimeUnknown }; return <div className={`flow-node ${selected ? 'selected' : ''}`}><Handle type="target" position={Position.Left} /><div className="flow-node-head"><span className={`node-status ${readiness === 'ready' ? 'status-success' : ''}`} /><Boxes size={15} /><strong>{plugin.name}</strong><MoreHorizontal size={14} /></div><code>{plugin.id}</code><small>v{plugin.version} · {labels[readiness]}</small><Handle type="source" position={Position.Right} /></div> }

export function FileDocument({ controller, document, theme, t }: { controller: StudioController; document: Document; theme: ThemePreference; t: Copy }) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const setDocumentContent = useStudioStore((state) => state.setDocumentContent)

  useEffect(() => {
    if (!host.current) return
    try {
      const language = document.path?.endsWith('.json') ? json() : document.path?.endsWith('.md') ? markdown() : yaml()
      const state = EditorState.create({
        doc: document.content ?? '',
        extensions: [basicSetup, keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]), language, ...(theme === 'dark' ? [oneDark] : []), EditorView.updateListener.of((update) => {
          if (update.docChanged) setDocumentContent(document.id, update.state.doc.toString())
        })],
      })
      const editor = new EditorView({ state, parent: host.current })
      editorRef.current = editor
      setEditorError(null)
      return () => { editor.destroy(); editorRef.current = null }
    } catch (reason: unknown) {
      editorRef.current = null
      setEditorError(reason instanceof Error && reason.message ? reason.message : 'Code editor initialization failed')
      return undefined
    }
  }, [document.id, theme, setDocumentContent])

  useEffect(() => {
    const editor = editorRef.current
    const content = document.content ?? ''
    if (editor && editor.state.doc.toString() !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
  }, [document.content])

  return <section className="editor-workspace"><div className="editor-toolbar"><div className="file-breadcrumb"><File size={15} /><span>{document.path}</span>{document.dirty && <span className="dirty-label">modified</span>}</div><div className="toolbar-actions"><button className="icon-button" title={t.external} onClick={() => { if (document.path) void controller.api.openFileExternally(document.path, '') }}><MoreHorizontal size={16} /></button><button className="primary-button compact" disabled={!document.dirty} onClick={() => { void controller.saveDocument(document.id) }}><Save size={15} />{t.save}</button></div></div>{editorError ? <div className="editor-fallback"><div className="editor-error">{editorError}</div><textarea aria-label={document.path ?? 'File contents'} value={document.content ?? ''} onChange={(event) => { setDocumentContent(document.id, event.target.value); }} /></div> : <div className="code-editor" ref={host} />}</section>
}

export function Inspector({ controller, workspace, selected, output }: { controller: StudioController; workspace: Workspace; selected: { kind: 'plugin' | 'link'; id: string } | null; output: string }) { const plugin = selected?.kind === 'plugin' ? workspace.graph.plugins.find((item) => item.id === selected.id) : undefined; const link = selected?.kind === 'link' ? workspace.graph.links.find((item) => item.id === selected.id) : undefined; if (!plugin && !link) return <aside className="inspector"><div className="inspector-empty"><CircleDot size={18} /><span>Select a node or edge</span></div></aside>; return <aside className="inspector"><div className="inspector-panel"><div className="inspector-heading"><span>{plugin ? 'Runtime plugin' : 'Link contract'}</span><button className="icon-button small" title="Delete" onClick={() => { if (plugin) void controller.deleteNodes([plugin.id]); if (link) void controller.deleteEdges([link.id]) }}><Trash2 size={15} /></button></div>{plugin && <><h2>{plugin.name}</h2><code>{plugin.id}</code><InspectorField label="Version" value={plugin.version} /><InspectorField label="Manifest" value={plugin.manifestVersion} /><InspectorField label="Service" value={plugin.servicePath} /><InspectorField label="Settings" value={plugin.settingsPath} /><InspectorField label="Schema" value={plugin.settingsSchemaPath} /><div className="inspector-actions"><button className="secondary-button compact" onClick={() => void controller.runtimeCommand('runtime.restart', plugin.id)}>Restart</button><button className="secondary-button compact" onClick={() => void controller.runtimeCommand('runtime.logs', plugin.id)}>Logs</button><button className="secondary-button compact" onClick={() => void controller.runtimeCommand('runtime.inspect', plugin.id)}>Inspect</button></div>{output && <pre className="runtime-output">{output}</pre>}</>}{link && <><h2>{link.caller} → {link.target}</h2><InspectorField label="Contract" value={link.contractVersion} /><InspectorField label="Methods" value={link.methods.join(', ')} /><InspectorField label="Transport" value={link.transport} /><InspectorField label="Security" value={link.securityProfile} /><InspectorField label="Timeout" value={`${String(link.timeoutMillis)} ms`} /><InspectorField label="Redaction" value={link.redactionPolicy} /></>}</div></aside> }
function InspectorField({ label, value }: { label: string; value: string }) { return <div className="inspector-field"><span>{label}</span><code>{value || '—'}</code></div> }

export function GitSidebar({ workspace, t, controller }: { workspace: Workspace; t: Copy; controller: StudioController }) { return <><div className="sidebar-heading"><span>{t.git}</span><GitBranch size={15} /></div>{!workspace.git.available ? <div className="sidebar-callout"><CircleAlert size={17} /><strong>{t.noGit}</strong><span>Workspace files are safe. Initialize a repository to track changes.</span><button className="primary-button compact" onClick={() => void controller.initializeGit()}>{t.initGit}</button></div> : <><div className="git-summary"><span className="status-dot" /><strong>{workspace.git.branch || 'HEAD'}</strong><code>{workspace.git.revision || 'uncommitted'}</code></div><div className="sidebar-heading sub"><span>{workspace.git.changes.length} changes</span><button className="icon-button small" title="Refresh" onClick={() => void controller.run('project.inspect')}><RefreshCw size={14} /></button></div><div className="change-list">{workspace.git.changes.map((change: GitChange) => <div className="change-row" key={change.path}><File size={14} /><span>{change.path}</span><code>{change.worktreeStatus || change.indexStatus}</code></div>)}</div><button className="secondary-button full" onClick={() => void controller.run('validate')}><Check size={15} />Validate</button></>}</> }

export function BottomDock({ controller, active, diagnostics, cliEvents, traffic, workspace, t }: { controller: StudioController; active: DockPanel | null; diagnostics: Diagnostic[]; cliEvents: CLIEvent[]; traffic: TrafficRecordView[]; workspace: Workspace; t: Copy }) {
  const toggleDock = useStudioStore((state) => state.toggleDock)
  const buttons: Array<[DockPanel, typeof CircleAlert, string, number]> = [['problems', CircleAlert, t.problems, diagnostics.length], ['cli', Terminal, t.cli, cliEvents.length], ['git', GitBranch, t.git, workspace.git.changes.length], ['reports', Activity, t.reports, traffic.length], ['tools', Zap, t.tools, 0], ['runtime', Boxes, 'Runtime', cliEvents.length]]
  return (
    <div className={`bottom-dock ${active ? 'expanded' : ''}`}>
      <div className="dock-buttons">{buttons.map(([id, Icon, label, badge]) => <button key={id} className={`dock-button ${active === id ? 'active' : ''}`} title={label} onClick={() => { toggleDock(id) }}><Icon size={16} />{badge > 0 && <span className="dock-badge">{badge}</span>}</button>)}<span className="dock-spacer" /><button className="dock-run" title="Run validate" onClick={() => void controller.run('validate')}><Play size={14} /></button></div>
      {active && <div className="dock-content">
        {active === 'problems' && (diagnostics.length ? diagnostics.slice(-5).map((item) => <div className="dock-line" key={`${item.timestamp}-${item.code}`}><CircleAlert size={14} /><span>{item.code}</span><small>{item.message}</small></div>) : <span className="muted">{t.clean}</span>)}
        {active === 'cli' && (cliEvents.length ? cliEvents.slice(-8).map((item, index) => <div className="dock-line" key={`${item.timestamp ?? ''}-${String(index)}`}><Terminal size={14} /><span>{item.type}</span><small>{summarizeCLIEvent(item)}</small></div>) : <span className="muted">CLI output will appear here.</span>)}
        {active === 'git' && <span className="muted">{workspace.git.changes.length} changes · {workspace.git.branch || 'no branch'}</span>}
        {active === 'reports' && <span className="muted">{traffic.length} redacted traffic records.</span>}
        {active === 'tools' && <span className="muted">Installed Studio tools.</span>}
        {active === 'runtime' && (cliEvents.length ? cliEvents.slice(-8).map((item, index) => <div className="dock-line" key={`${item.operationId ?? ''}-${String(index)}`}><Terminal size={14} /><span>{item.type}</span><small>{summarizeCLIEvent(item)}</small></div>) : <span className="muted">Runtime events will appear through CLI.</span>)}
      </div>}
    </div>
  )
}

export function ArtifactsView({ controller, t }: { controller: StudioController; t: Copy }) {
  const [artifacts, setArtifacts] = useState<ArtifactReference[]>([])
  const [id, setID] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [platform, setPlatform] = useState('linux/arm64')
  const [binaryPath, setBinaryPath] = useState('')
  const [busy, setBusy] = useState(false)
  async function reload() { setArtifacts(await controller.listArtifacts()) }
  useEffect(() => { void reload() }, [])
  async function chooseBinary() {
    const path = await controller.api.selectRuntimeArtifactBinary()
    if (path) setBinaryPath(path)
  }
  async function register() {
    const path = binaryPath.trim()
    if (!path || !id.trim()) return
    setBusy(true)
    try {
      const artifact = await controller.registerArtifact(id.trim(), version.trim(), platform.trim(), path)
      if (artifact) { setID(''); setBinaryPath(''); await reload() }
    } finally {
      setBusy(false)
    }
  }
  async function trust(artifact: ArtifactReference) { if (!artifact.digest) return; await controller.trustArtifact(artifact.id, artifact.version, artifact.platform, artifact.digest); await reload() }
  return <section className="settings-view artifacts-view">
    <div className="settings-header"><span className="eyebrow">{t.artifacts}</span><h1>Operator-owned binaries</h1><p>Studio registers existing binaries. It never builds plugins or stores their paths in the Project.</p></div>
    <div className="settings-grid">
      <div className="settings-section">
        <h3>Register binary</h3>
        <div className="setup-row">
          <input value={id} onChange={(event) => { setID(event.target.value) }} placeholder="plugin id" aria-label="Plugin id" />
          <input value={version} onChange={(event) => { setVersion(event.target.value) }} placeholder="version" aria-label="Artifact version" />
          <input value={platform} onChange={(event) => { setPlatform(event.target.value) }} placeholder="linux/arm64" aria-label="Artifact platform" />
        </div>
        <div className="setup-row">
          <input value={binaryPath} onChange={(event) => { setBinaryPath(event.target.value) }} placeholder="Absolute path to existing binary" aria-label="Binary path" />
          <button className="secondary-button compact" disabled={busy} onClick={() => void chooseBinary()}><FolderOpen size={14} />Browse</button>
          <button className="primary-button compact" disabled={busy || !id.trim() || !binaryPath.trim()} onClick={() => void register()}><PackageCheck size={14} />Register</button>
        </div>
        <p className="muted">The external path is kept only in the CLI artifact registry, never in the Project.</p>
      </div>
      <div className="settings-section">
        <h3>Registered artifacts</h3>
        {artifacts.length === 0 ? <span className="muted">No binaries registered.</span> : <div className="change-list">{artifacts.map((artifact) => <div className="change-row" key={`${artifact.id}:${artifact.version}:${artifact.platform}`}><PackageCheck size={14} /><span><strong>{artifact.id}</strong><small>{artifact.version} · {artifact.platform} · {artifact.digest.slice(0, 20)}…</small></span><span className={`status-dot ${artifact.trusted ? 'status-success' : 'status-warning'}`} />{!artifact.trusted && <button className="secondary-button compact" onClick={() => void trust(artifact)}>Trust</button>}</div>)}</div>}
      </div>
    </div>
  </section>
}

export function RuntimeView({ controller, workspace, t }: { controller: StudioController; workspace: Workspace; t: Copy }) {
  const [pluginID, setPluginID] = useState(workspace.graph.plugins[0]?.id ?? '')
  const [view, setView] = useState<'manifest' | 'schema' | 'status'>('status')
  const output = useStudioStore((state) => state.runtimeOutput)
  useEffect(() => { if (!pluginID) setPluginID(workspace.graph.plugins[0]?.id ?? '') }, [pluginID, workspace.graph.plugins])
  return <section className="settings-view runtime-view"><div className="settings-header"><span className="eyebrow">{t.runtime}</span><h1>Core-backed runtime</h1><p>Docker is orchestrated by CLI; plugin metadata is read by Core through the SDK.</p></div><div className="settings-grid"><div className="settings-section"><h3>Runtime control</h3><div className="build-actions"><button className="secondary-button compact" title={t.runtimePlanHint} onClick={() => void controller.run('runtime.plan')}><ListChecks size={14} />{t.runtimePlan}</button><button className="primary-button compact" onClick={() => void controller.run('runtime.start')}><Play size={14} />Start</button><button className="secondary-button compact" onClick={() => void controller.run('runtime.stop')}>Stop</button><button className="secondary-button compact" onClick={() => void controller.run('runtime.status')}><RefreshCw size={14} />Status</button><button className="secondary-button compact" onClick={() => void controller.run('core.status')}>Core</button></div></div><div className="settings-section"><h3>Plugin metadata</h3><div className="setup-row"><select value={pluginID} onChange={(event) => { setPluginID(event.target.value) }}>{workspace.graph.plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.id}</option>)}</select><select value={view} onChange={(event) => { setView(event.target.value as typeof view) }}><option value="status">Status</option><option value="manifest">Manifest</option><option value="schema">Config schema</option></select><button className="secondary-button compact" disabled={!pluginID} onClick={() => void controller.pluginMetadata(pluginID, view)}>Read via Core</button></div>{output && <pre className="runtime-output">{output}</pre>}</div></div></section>
}

export function SettingsView({ controller, locale, theme, toolchain, t }: { controller: StudioController; locale: Locale; theme: ThemePreference; toolchain: ToolchainStatus | null; t: Copy }) {
  const target = useStudioStore((state) => state.target)
  const profile = useStudioStore((state) => state.profile)
  const setField = useStudioStore((state) => state.setField)

  return (
    <section className="settings-view">
      <div className="settings-header"><span className="eyebrow">Studio</span><h1>{t.settingsTitle}</h1><p>Global preferences and local toolchain status.</p></div>
      <div className="settings-grid">
        <div className="settings-section"><h3>{t.language}</h3><div className="segmented"><button className={locale === 'ru' ? 'active' : ''} onClick={() => void controller.setLocale('ru')}>Русский</button><button className={locale === 'en' ? 'active' : ''} onClick={() => void controller.setLocale('en')}>English</button></div></div>
        <div className="settings-section"><h3>{t.theme}</h3><div className="segmented"><button className={theme === 'system' ? 'active' : ''} onClick={() => void controller.setTheme('system')}>System</button><button className={theme === 'light' ? 'active' : ''} onClick={() => void controller.setTheme('light')}><Sun size={14} />{t.light}</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => void controller.setTheme('dark')}><Moon size={14} />{t.dark}</button></div></div>
        <div className="settings-section"><h3>Toolchain</h3><div className="toolchain-card"><Terminal size={18} /><span><strong>{toolchain?.cliAvailable ? toolchain.cliPath : t.cliMissing}</strong><small>{toolchain?.cliVersion || toolchain?.errorCode || '—'}</small></span><span className={`status-dot ${toolchain?.cliAvailable ? 'status-success' : 'status-warning'}`} /></div></div>
        <div className="settings-section">
          <h3>Local Core setup</h3>
          <div className="setup-row"><select value={target} onChange={(event) => { setField('target', event.target.value) }}><option value="local">local</option></select><button className="secondary-button compact" onClick={() => void controller.run('target.list')}>List targets</button><button className="secondary-button compact" onClick={() => void controller.run('target.test')}>Test</button><button className="secondary-button compact" onClick={() => void controller.run('core.status')}>Status</button><button className="secondary-button compact" onClick={() => void controller.run('credential.status')}>{locale === 'ru' ? 'Доступ' : 'Credential'}</button></div>
          <div className="setup-row"><input readOnly value={profile} placeholder="No target profile selected" /><button className="secondary-button compact" onClick={() => void controller.api.selectTargetProfile().then((value) => { if (value) setField('profile', value) })}>Choose profile</button><button className="primary-button compact" disabled={!profile} onClick={() => void controller.api.runStudioCommand('target.add', target, '', profile)}><Plus size={14} />Register</button></div>
          <div className="setup-row"><button className="secondary-button compact" onClick={() => void controller.run('core.start')}><Play size={14} />Start Core</button><button className="secondary-button compact" onClick={() => void controller.run('core.stop')}>Stop Core</button><button className="secondary-button compact" onClick={() => void controller.run('core.logs')}>Logs</button></div>
        </div>
      </div>
    </section>
  )
}

export function CommandPalette({ controller, t }: { controller: StudioController; t: Copy }) { const close = useStudioStore((state) => state.setCommandOpen); const query = useStudioStore((state) => state.commandQuery); const setField = useStudioStore((state) => state.setField); const navigate = useStudioStore((state) => state.navigate); const commands: Array<[string, string, () => void]> = [[t.graph, 'Open plugin graph', () => { navigate('graph'); }], [t.files, 'Open project files', () => { navigate('files'); }], [t.git, 'Open version control', () => { navigate('git'); }], ['Validate', 'Run liapoldus validate', () => void controller.run('validate')], ['Local Core', 'Show local Core status', () => void controller.run('core.status')], [t.settings, 'Open preferences', () => { navigate('settings'); }]]; const filtered = commands.filter(([label, detail]) => `${label} ${detail}`.toLowerCase().includes(query.toLowerCase())); return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(false) }}><div className="command-modal"><div className="command-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => { setField('commandQuery', event.target.value); }} placeholder={t.command} /><kbd>Esc</kbd></div><div className="command-results">{filtered.map(([label, detail, action]) => <button key={label} onClick={() => { action(); close(false) }}><span><strong>{label}</strong><small>{detail}</small></span><span>›</span></button>)}</div></div></div> }

export function CreateProjectDialog({ controller, t }: { controller: StudioController; t: Copy }) { const close = useStudioStore((state) => state.setCreateOpen); const id = useStudioStore((state) => state.projectID); const name = useStudioStore((state) => state.projectName); const setField = useStudioStore((state) => state.setField); return <div className="modal-backdrop"><form className="dialog" onSubmit={(event) => { event.preventDefault(); void controller.createProject() }}><div className="dialog-heading"><div><span className="eyebrow">Project</span><h2>{t.create}</h2></div><button type="button" className="icon-button" onClick={() => { close(false); }}><X size={17} /></button></div><label>Project id<input autoFocus value={id} onChange={(event) => { setField('projectID', event.target.value); }} placeholder="my-project" /></label><label>Name<input value={name} onChange={(event) => { setField('projectName', event.target.value); }} placeholder="My Project" /></label><p className="dialog-hint">A new folder and Git repository will be created in the selected parent directory.</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { close(false); }}>{t.close}</button><button className="primary-button" type="submit"><Plus size={15} />{t.create}</button></div></form></div> }
export function PluginDialog({ controller, t }: { controller: StudioController; t: Copy }) { const close = useStudioStore((state) => state.setPluginOpen); const id = useStudioStore((state) => state.pluginID); const name = useStudioStore((state) => state.pluginName); const setField = useStudioStore((state) => state.setField); return <div className="modal-backdrop"><form className="dialog" onSubmit={(event) => { event.preventDefault(); void controller.addPlugin() }}><div className="dialog-heading"><div><span className="eyebrow">Runtime plugin</span><h2>{t.newPlugin}</h2></div><button type="button" className="icon-button" onClick={() => { close(false); }}><X size={17} /></button></div><label>Plugin id<input autoFocus value={id} onChange={(event) => { setField('pluginID', event.target.value); }} placeholder="orders" /></label><label>Name<input value={name} onChange={(event) => { setField('pluginName', event.target.value); }} placeholder="Orders" /></label><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { close(false); }}>{t.close}</button><button className="primary-button" type="submit"><Plus size={15} />{t.create}</button></div></form></div> }
