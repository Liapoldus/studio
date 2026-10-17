import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, MiniMap, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { EdgeChange, NodeChange } from '@xyflow/react'
import { Activity, Boxes, Check, ChevronDown, ChevronUp, CircleAlert, CircleDot, Copy as CopyIcon, Download, FolderOpen, GripVertical, Moon, MoreHorizontal, Play, Plus, Plug, Puzzle, RefreshCw, Server, Sun, Terminal, Trash2, X, PackageCheck, ExternalLink, AlertTriangle, Undo2, Redo2 } from 'lucide-react'
import type { ArtifactReference, CLIEvent, CoreSettingsView, Diagnostic, ServiceLink, ServiceLinkInput, ReportSummary, RuntimeService, ServiceSettingsSchemaPreview, ThemePreference, ToolchainStatus, Workspace } from '../api/types'
import type { StudioController } from '../controllers/studioController'
import { text, type Copy } from '../models/copy'
import { graphEdgeHandles } from '../models/graph'
import { groupDiagnostics } from '../models/diagnostics'
import { configurationDraftKey, isSensitiveConfigurationFieldName, mergeConfiguration, parseConfigurationJSONDocument, parseConfigurationNumber } from '../models/configurationDraft'
import { configurationApplyReviewPaths } from '../models/configurationApplyReview'
import { configurationSchemaArrayItem, configurationSchemaCanCreateProtectedArrayItem, configurationSchemaProtected, configurationSchemaRenderable, configurationSchemaVariants, configurationVariantValue, createConfigurationSchemaValue, effectiveConfigurationSchema, selectedConfigurationVariant } from '../models/configurationSchema'
import { configurationArrayOperationRequest, createConfigurationArrayItem, duplicateConfigurationArrayItem, moveConfigurationArrayItem, removeConfigurationArrayItem, reorderConfigurationArrayItem } from '../models/configurationArray'
import { configurationMapOperationRequest, configurationMapOperations, isConfigurationMapOperationRequest, removeConfigurationMapKey, safeConfigurationMapKey } from '../models/configurationMap'
import { configurationSchemaDifferencePaths, configurationUIFieldKey, matchServiceConfigurationUIField, projectCertificateCanImport, projectResourceCanOpen, schemaAtPointer, supportsServiceResourceCatalog, type ServiceConfigurationResource, type ServiceConfigurationUI, type ServiceConfigurationUIField } from '../models/serviceConfigurationUI'
import { messageOf, operationReplicaOutcomes, summarizeCLIEvent, type CLIStreamState, type Locale, type TabKind, type WorkspaceTab } from '../models/studio'
import { useStudioStore } from '../stores/studio'
import type { StudioPluginSurface } from '../stores/studio'
import { createStudioBridgeSessionID, isStudioPluginSurfaceReadyMessage, parseStudioPluginBridgeRequest, startStudioPluginHandshake, studioPluginBridgeFailureCode, studioPluginPermissionGranted, studioPluginSurfaceAssetURL, studioServiceEditorBridgeVersion, withPeerCatalogDeadline } from '../models/pluginSurface'
import { latestStudioPluginSurfaces, workspacePluginNavigationSurfaces } from '../models/studioPluginPackage'
import { resolveServiceEditorButtons, serviceInspectorHiddenSettingsPaths, serviceInspectorPathIsHidden } from '../models/serviceEditorButtons'
import { groupRuntimeArtifacts, projectSettingsApplied, runtimeReplicasForService, runtimeServiceActionConfirmationText } from '../models/runtime'
import { BrandMark } from '../ui/BrandMark'
import { LocalServiceSecretsSettings } from './LocalServiceSecretsSettings'

export function ActivityBar({ activeId, t, onNavigate, surfaces, onOpenSurface }: { activeId: string | null; t: Copy; onNavigate: (item: TabKind) => void; surfaces: StudioPluginSurface[]; onOpenSurface: (surface: StudioPluginSurface) => void }) {
  const entries: Array<[TabKind, typeof Boxes, string]> = [['canvas', Boxes, t.graph], ['reports', Activity, t.reports], ['problems', CircleAlert, t.problems], ['output', Terminal, 'Output']]
  const currentSurfaces = workspacePluginNavigationSurfaces(surfaces)
  return <nav className="activity-bar" aria-label={t.home}>{entries.map(([id, Icon, label]) => <button type="button" key={id} className={`activity-button ${activeId === id ? 'active' : ''}`} title={label} aria-label={label} aria-current={activeId === id ? 'page' : undefined} onClick={() => { onNavigate(id); }}><Icon size={18} /></button>)}{currentSurfaces.length > 0 && <span className="activity-divider" />}{currentSurfaces.map((surface) => { const id = `studio-plugin:${surface.studioPluginId}:${surface.version}:${surface.id}`; return <button type="button" key={id} className={`activity-button ${activeId === id ? 'active' : ''}`} title={`${surface.studioPluginId} · ${surface.title}`} aria-label={`${surface.studioPluginId} · ${surface.title}`} aria-current={activeId === id ? 'page' : undefined} onClick={() => { onOpenSurface(surface); }}><Puzzle size={16} /></button> })}</nav>
}

export function HomeView({ controller, locale, theme, projects, toolchain, error, onOpen, onCreate, onOpenProject }: { controller: StudioController; locale: Locale; theme: ThemePreference; projects: Array<{ rootPath: string; name: string }>; toolchain: ToolchainStatus | null; error: string | null; onOpen: () => void; onCreate: () => void; onOpenProject: (root: string) => void }) {
  const t = text[locale]
  return (
    <div className="home-screen">
      <div className="home-hero">
        <div className="home-brand">
          <BrandMark size={72} />
          <span><strong>Liapoldus</strong><small>Build. Distribute. Together.</small></span>
        </div>
        <span className="eyebrow">Liapoldus Studio</span>
        <h1>Build with clarity.</h1>
        <p>Desktop workbench for CLI projects, runtime services and local Core workflows.</p>
        <div className="home-actions">
          <button className="primary-button" onClick={onOpen}><FolderOpen size={16} />{t.open}</button>
          <button className="secondary-button" onClick={onCreate}><Plus size={16} />{t.create}</button>
        </div>
        {error && <div className="home-error"><CircleAlert size={15} />{error}</div>}
      </div>
      <div className="home-grid">
        <section className="home-card">
          <div className="card-heading"><span>{t.recent}</span><span className="status-dot" /></div>
          {projects.length === 0 ? <div className="home-empty"><FolderOpen size={28} aria-hidden="true" /><span>{t.noProjects}</span></div> : projects.slice(0, 8).map((project) => (
            <button className="recent-project" key={project.rootPath} onClick={() => { onOpenProject(project.rootPath) }}>
              <span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{project.name}</strong><small>{project.rootPath}</small></span><span>›</span>
            </button>
          ))}
        </section>
        <section className="home-card">
          <div className="card-heading"><span>Environment</span><Server size={16} aria-hidden="true" /></div>
          <div className="environment-row"><span>CLI</span><strong className={toolchain?.cliAvailable ? 'text-success' : 'text-warning'}>{toolchain?.cliAvailable ? toolchain.cliVersion || 'available' : t.cliMissing}</strong></div>
          <div className="environment-row"><span>Desktop</span><strong>Wails · React</strong></div>
          <div className="home-settings">
            <button className="segmented-button" onClick={() => void controller.setLocale('ru')}>RU</button>
            <button className="segmented-button" onClick={() => void controller.setLocale('en')}>EN</button>
            <button className={`segmented-button ${theme === 'dark' ? 'active' : ''}`} onClick={() => void controller.setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>
          </div>
        </section>
      </div>
    </div>
  )
}

export function GraphView({ controller, workspace, t }: { controller: StudioController; workspace: Workspace; t: Copy }) {
  const layout = useStudioStore((state) => state.layout)
  const nodes = useStudioStore((state) => state.canvasNodes)
  const edges = useStudioStore((state) => state.canvasEdges)
  const setCanvasNodes = useStudioStore((state) => state.setCanvasNodes)
  const setCanvasEdges = useStudioStore((state) => state.setCanvasEdges)
  const setSelected = useStudioStore((state) => state.setSelected)
  const setServiceOpen = useStudioStore((state) => state.setServiceOpen)
  const serviceKey = workspace.graph.services.map((service) => service.id).join('\u0000')

  useEffect(() => {
    const positions = new Map(workspace.graph.services.map((service, index) => [
      service.id,
      layout[service.id] ?? { x: 80 + (index % 3) * 260, y: 80 + Math.floor(index / 3) * 170 },
    ]))
    setCanvasNodes(workspace.graph.services.map((service, index) => ({
      id: service.id,
      type: 'service',
      position: positions.get(service.id) ?? { x: 80 + (index % 3) * 260, y: 80 + Math.floor(index / 3) * 170 },
      data: { service },
    })))
    setCanvasEdges(workspace.graph.links.map((link) => {
      const source = positions.get(link.caller) ?? { x: 0, y: 0 }
      const target = positions.get(link.target) ?? { x: 260, y: 0 }
      return {
        id: link.id,
        source: link.caller,
        target: link.target,
        ...graphEdgeHandles(source, target),
        label: link.methods.join(', '),
        animated: link.valid,
        type: 'smoothstep',
      }
    }))
  }, [workspace.graph, layout, setCanvasNodes, setCanvasEdges])

  useEffect(() => { void controller.refreshRuntimeStatuses() }, [controller, workspace.project?.id, serviceKey])

  function onNodesChange(changes: NodeChange[]) {
    setCanvasNodes(applyNodeChanges(changes, useStudioStore.getState().canvasNodes))
  }

  function onEdgesChange(changes: EdgeChange[]) {
    setCanvasEdges(applyEdgeChanges(changes, useStudioStore.getState().canvasEdges))
  }

  return <section className="graph-workspace">
    <div className="workspace-toolbar">
      <div><span className="eyebrow">{t.graph}</span><h1>{t.services}: {workspace.graph.services.length} <span className="toolbar-muted">· {workspace.graph.links.length} links</span></h1></div>
      <div className="toolbar-actions">
        <span className="runtime-chip">Runtime · CLI</span>
        <button className="icon-button" title="Refresh" onClick={() => { void controller.refreshGraph() }}><RefreshCw size={16} /></button>
        <button className="secondary-button compact" onClick={() => { setServiceOpen(true) }}><Plus size={15} />{localeLabel(t, 'Подключить сервис', 'Connect service')}</button>
      </div>
    </div>
    <div className="flow-wrap">
      {workspace.graph.services.length === 0
        ? <div className="graph-empty">
          <div className="empty-orbit"><Boxes size={24} /></div>
          <strong>{t.emptyGraph}</strong>
          <span>services/&lt;service&gt; and links are canonical project files.</span>
          <div className="empty-actions">
            <button className="primary-button compact" onClick={() => { setServiceOpen(true) }}><Plus size={15} />{localeLabel(t, 'Подключить сервис', 'Connect service')}</button>
          </div>
        </div>
        : <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ service: ServiceFlowNode }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(connection) => { void controller.createLink(connection) }}
          onNodesDelete={(deleted) => { void controller.deleteNodes(deleted.map((node) => node.id)) }}
          onEdgesDelete={(deleted) => { void controller.deleteEdges(deleted.map((edge) => edge.id)) }}
          onNodeDragStop={(_, node) => { controller.persistNodePosition(node.id, node.position) }}
          onNodeClick={(_, node) => { setSelected({ kind: 'service', id: node.id }) }}
          onEdgeClick={(_, edge) => { setSelected({ kind: 'link', id: edge.id }) }}
          fitView
          deleteKeyCode="Delete"
          selectionOnDrag
          panOnDrag
        >
          <Background gap={24} size={1} color="var(--grid)" />
          <MiniMap pannable zoomable nodeColor="var(--accent)" />
          <Controls showInteractive={false} />
        </ReactFlow>}
    </div>
  </section>
}
function ServiceFlowNode({ data, selected }: { data: { service: RuntimeService }; selected?: boolean }) {
  const service = data.service
  const readiness = useStudioStore((state) => state.runtimeStatuses[service.id] ?? 'unknown')
  const locale = useStudioStore((state) => state.locale)
  const t = text[locale]
  const labels = { ready: t.runtimeReady, degraded: t.runtimeDegraded, 'not-ready': t.runtimeNotReady, unknown: t.runtimeUnknown }
  return <div className={`flow-node ${selected ? 'selected' : ''}`}>
    <Handle id="in-left" type="target" position={Position.Left} style={{ top: '44%' }} />
    <Handle id="out-left" type="source" position={Position.Left} style={{ top: '56%' }} />
    <Handle id="out-right" type="source" position={Position.Right} style={{ top: '44%' }} />
    <Handle id="in-right" type="target" position={Position.Right} style={{ top: '56%' }} />
    <div className="flow-node-head"><span className={`node-status ${readiness === 'ready' ? 'status-success' : ''}`} /><Plug size={16} aria-hidden="true" /><strong>{service.name}</strong><MoreHorizontal size={14} /></div>
    <code>{service.id}</code>
    <small>v{service.version} · {labels[readiness]}</small>
  </div>
}

type InspectorSectionState = {
  scope: string
  openSections: Record<string, boolean>
  onToggle: (key: string, open: boolean) => void
}

const defaultInspectorSectionState: InspectorSectionState = { scope: '', openSections: {}, onToggle: () => undefined }
const InspectorSectionStateContext = createContext(defaultInspectorSectionState)

export function Inspector({ controller, workspace, selected, output, openSections, onSectionToggle }: { controller: StudioController; workspace: Workspace; selected: { kind: 'service' | 'link' | 'plugin'; id: string } | null; output: string; openSections: Record<string, boolean>; onSectionToggle: (key: string, open: boolean) => void }) {
  const service = selected?.kind === 'service' ? workspace.graph.services.find((item) => item.id === selected.id) : undefined
  const link = selected?.kind === 'link' ? workspace.graph.links.find((item) => item.id === selected.id) : undefined
  const readiness = useStudioStore((state) => service ? state.runtimeStatuses[service.id] ?? 'unknown' : 'unknown')
  const replicas = useStudioStore((state) => runtimeReplicasForService(state.runtimeReplicas, service?.id))
  const locale = useStudioStore((state) => state.locale)
  const target = useStudioStore((state) => state.target)
  const [pendingServiceAction, setPendingServiceAction] = useState<'stop' | 'restart' | null>(null)
  const [editorButtons, setEditorButtons] = useState<Array<{ id: string; key: string; label: { ru: string; en: string }; description: { ru: string; en: string } }>>([])
  const [editorButtonsStatus, setEditorButtonsStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const pluginSurfaces = useStudioStore((state) => state.studioPluginSurfaces)
  const sectionState = { scope: `${workspace.project?.id ?? 'project'}:${selected?.kind ?? 'empty'}:${selected?.id ?? 'none'}`, openSections, onToggle: onSectionToggle }
  useEffect(() => {
    let active = true
    if (!service || !workspace.project?.id) { setEditorButtons([]); setEditorButtonsStatus('unavailable'); return () => { active = false } }
    setEditorButtons([])
    setEditorButtonsStatus('loading')
    void controller.readServiceEditorButtons(workspace.project.id, service.id).then((buttons) => { if (active) { setEditorButtons(buttons); setEditorButtonsStatus('ready') } }).catch(() => { if (active) { setEditorButtons([]); setEditorButtonsStatus('unavailable') } })
    return () => { active = false }
  }, [controller, service?.id, service?.version, workspace.project?.id, readiness])
  if (!service && !link) return <InspectorSectionStateContext.Provider value={sectionState}><aside className="inspector"><div className="inspector-empty"><CircleDot size={18} /><span>{locale === 'ru' ? 'Выберите узел или связь' : 'Select a node or link'}</span></div></aside></InspectorSectionStateContext.Provider>
  return <InspectorSectionStateContext.Provider value={sectionState}><><aside className="inspector"><div className="inspector-panel">
    <div className="inspector-heading"><span>{service ? (locale === 'ru' ? 'Свойства сервиса' : 'Service properties') : (locale === 'ru' ? 'Контракт связи' : 'Link contract')}</span><button className="icon-button small" title={locale === 'ru' ? 'Удалить' : 'Delete'} onClick={() => { if (service) void controller.deleteNodes([service.id]); if (link) void controller.deleteEdges([link.id]) }}><Trash2 size={15} /></button></div>
    {service && <>
      <InspectorSection title={locale === 'ru' ? 'Идентификация' : 'Identity'}><h2>{service.name}</h2><code>{service.id}</code><InspectorField label="Version" value={service.version} /><InspectorField label="Manifest" value={service.manifestVersion} /><InspectorField label="Readiness" value={readiness} /></InspectorSection>
      <InspectorSection title={locale === 'ru' ? 'Настройки' : 'Settings'}><ServiceSettingsInspector controller={controller} service={service} locale={locale} /></InspectorSection>
      {(editorButtons.length > 0 || service.id === 'server') && <ServiceEditorButtons controller={controller} service={service} projectID={workspace.project?.id ?? ''} locale={locale} buttons={editorButtons} status={editorButtonsStatus} surfaces={pluginSurfaces} />}
      <InspectorSection title={locale === 'ru' ? 'Применение конфигурации' : 'Configuration rollout'}>
        {replicas.length === 0 ? <span className="muted">{locale === 'ru' ? 'Статус реплик недоступен.' : 'Replica status is unavailable.'}</span> : replicas.map((replica) => <div className="inspector-field" key={replica.replicaId}>
          <span>{replica.replicaId} · {configurationStateLabel(replica.configurationState, locale)}</span>
          <code>{locale === 'ru' ? 'Применено' : 'Applied'} {replica.appliedGeneration ?? '—'} / {locale === 'ru' ? 'Желаемое' : 'Desired'} {replica.desiredGeneration ?? '—'}{replica.lastFailureCode ? ` · ${replica.lastFailureCode}` : ''}</code>
        </div>)}
      </InspectorSection>
      <InspectorSection title={locale === 'ru' ? 'Источник' : 'Source binding'}><InspectorField label="Service" value={service.servicePath} /><InspectorField label="Settings" value={service.settingsPath} /><InspectorField label="Schema" value={service.settingsSchemaPath} /></InspectorSection>
      <InspectorSection title={locale === 'ru' ? 'Контекст проекта' : 'Project context'}><InspectorField label="Project" value={workspace.project?.name ?? '—'} /></InspectorSection>
      <InspectorSection title={locale === 'ru' ? 'Действия' : 'Actions'}><div className="inspector-actions"><button className="secondary-button compact" title={locale === 'ru' ? 'Запустить остановленный сервис; если Project pin отличается, заменить только этот контейнер и откатить его при ошибке.' : 'Start a stopped service; if its Project pin differs, replace only this container and roll back on failure.'} onClick={() => void controller.runtimeCommand('runtime.start', service.id)}>Start</button><button className="secondary-button compact" onClick={() => { setPendingServiceAction('stop') }}>Stop</button><button className="secondary-button compact" onClick={() => { setPendingServiceAction('restart') }}>Restart</button><button className="secondary-button compact" onClick={() => void controller.runtimeCommand('runtime.logs', service.id)}>Logs</button><button className="secondary-button compact" onClick={() => void controller.runtimeCommand('runtime.inspect', service.id)}>Inspect</button></div>{output && <pre className="runtime-output">{output}</pre>}</InspectorSection>
      <InspectorSection title={locale === 'ru' ? 'Последний отчёт проекта' : 'Latest project report'}><LatestProjectReport controller={controller} projectID={workspace.project?.id ?? ''} locale={locale} /></InspectorSection>
    </>}
    {link && <LinkContractInspector controller={controller} link={link} locale={locale} />}
  </div></aside>{service && pendingServiceAction && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingServiceAction(null) }}><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="service-runtime-action-heading" aria-describedby="service-runtime-action-description"><div className="dialog-heading"><div><span className="eyebrow">{locale === 'ru' ? `Локальный target · ${target}` : `Local target · ${target}`}</span><h2 id="service-runtime-action-heading">{locale === 'ru' ? `${pendingServiceAction === 'stop' ? 'Остановить' : 'Перезапустить'} ${service.name}?` : `${pendingServiceAction === 'stop' ? 'Stop' : 'Restart'} ${service.name}?`}</h2></div><button type="button" className="icon-button" aria-label={locale === 'ru' ? 'Отмена' : 'Cancel'} onClick={() => { setPendingServiceAction(null) }}><X size={16} /></button></div><p id="service-runtime-action-description" className="dialog-hint">{runtimeServiceActionConfirmationText(pendingServiceAction, service.id, service.name, target, locale)}</p><div className="dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => { setPendingServiceAction(null) }}>{locale === 'ru' ? 'Отмена' : 'Cancel'}</button><button type="button" className="primary-button" onClick={() => { const action = pendingServiceAction; setPendingServiceAction(null); void controller.runtimeCommand(action === 'stop' ? 'runtime.stop' : 'runtime.restart', service.id) }}>{locale === 'ru' ? `${pendingServiceAction === 'stop' ? 'Остановить' : 'Перезапустить'} ${service.id}` : `${pendingServiceAction === 'stop' ? 'Stop' : 'Restart'} ${service.id}`}</button></div></section></div>}</></InspectorSectionStateContext.Provider>
}

function ServiceEditorButtons({ controller, service, projectID, locale, buttons, status, surfaces }: { controller: StudioController; service: RuntimeService; projectID: string; locale: Locale; buttons: Array<{ id: string; key: string; label: { ru: string; en: string }; description: { ru: string; en: string } }>; status: 'loading' | 'ready' | 'unavailable'; surfaces: StudioPluginSurface[] }) {
  const [bindings, setBindings] = useState<Array<{ buttonId: string; pluginId: string; surfaceId: string }>>([])
  useEffect(() => {
    let active = true
    void controller.studioPluginEditorBindings().then((items) => { if (active) setBindings(items) }).catch(() => { if (active) setBindings([]) })
    return () => { active = false }
  }, [controller, projectID, buttons])
  const activeSurfaces = latestStudioPluginSurfaces(surfaces)
  const entries = resolveServiceEditorButtons(buttons, bindings, activeSurfaces)
  if (entries.length === 0) {
    const message = status === 'loading'
      ? (locale === 'ru' ? 'Читаем live manifest сервиса через CLI → Core…' : 'Reading the service live manifest through CLI → Core…')
      : status === 'unavailable'
        ? (locale === 'ru' ? 'Не удалось прочитать live manifest сервиса. Проверьте доступность CLI/Core и повторно откройте Inspector.' : 'Could not read the service live manifest. Check CLI/Core availability and reopen the Inspector.')
        : buttons.length > 0
          ? (locale === 'ru' ? 'Кнопка сервиса объявлена, но не назначена доступному установленному плагину. Откройте общие настройки → Плагины Studio и назначьте кнопку странице плагина.' : 'The service button is declared but is not assigned to an available installed plugin. Open global Settings → Studio Plugins and assign it to a plugin page.')
          : service.id === 'server'
            ? (locale === 'ru' ? `Server ${service.version} не объявляет кнопку редактора. Контракт кнопки добавлен в Server 1.1.7; обновите сервис, затем назначьте кнопку установленному Server Editor в общих настройках.` : `Server ${service.version} does not declare an editor button. The button contract was added in Server 1.1.7; update the service, then assign the button to the installed Server Editor in global Settings.`)
            : (locale === 'ru' ? `Сервис ${service.id} версии ${service.version} не объявил кнопку редактора в live manifest. Добавьте контракт service-editor-buttons/v1 и назначьте кнопку установленному плагину в общих настройках.` : `Service ${service.id} ${service.version} does not declare an editor button in its live manifest. Add the service-editor-buttons/v1 contract and assign the button to an installed plugin in global Settings.`)
    return <InspectorSection title={locale === 'ru' ? 'Редактор сервиса' : 'Service editor'}><p className="muted" role="status">{message}</p>{status === 'unavailable' && <button type="button" className="secondary-button compact" onClick={() => void controller.run('runtime.start')}>{locale === 'ru' ? 'Запустить проект для редактирования' : 'Run project to edit'}</button>}</InspectorSection>
  }
  return <InspectorSection title={locale === 'ru' ? 'Редакторы сервиса' : 'Service editors'}><div className="inspector-actions">{entries.map(({ button, surface }) => <button type="button" className="secondary-button compact" key={button.id} title={button.description[locale]} onClick={() => { useStudioStore.getState().openStudioPluginSurface(surface, { projectId: projectID, serviceId: service.id }) }}>{button.label[locale]}</button>)}</div></InspectorSection>
}

function configurationStateLabel(state: import('../api/types').RuntimeReplicaStatus['configurationState'], locale: Locale): string {
  if (locale === 'en') return state
  return ({ unconfigured: 'не настроено', unobserved: 'нет подтверждения', pending: 'ожидает', acknowledged: 'применено', stale: 'устарело', failed: 'ошибка', unreachable: 'недоступна' } as const)[state]
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  const state = useContext(InspectorSectionStateContext)
  const key = `${state.scope}:${title}`
  const open = state.openSections[key] ?? true
  return <details className="inspector-section" open={open} onToggle={(event) => { const nextOpen = event.currentTarget.open; if (nextOpen !== open) state.onToggle(key, nextOpen) }}><summary>{title}</summary><div className="inspector-section-body">{children}</div></details>
}
function InspectorField({ label, value }: { label: string; value: string }) { return <div className="inspector-field"><span>{label}</span><code>{value || '—'}</code></div> }

function LatestProjectReport({ controller, projectID, locale }: { controller: StudioController; projectID: string; locale: Locale }) {
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let current = true
    setLoading(true)
    setUnavailable(false)
    setSummary(null)
    if (!projectID) { setLoading(false); return () => { current = false } }
    void controller.api.latestReportSummary().then((value) => {
      if (current) setSummary(value)
    }).catch(() => {
      if (current) setUnavailable(true)
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [controller, projectID])
  if (loading) return <span className="muted">{locale === 'ru' ? 'Загрузка…' : 'Loading…'}</span>
  if (unavailable) return <span className="muted">{locale === 'ru' ? 'Сводка отчёта недоступна.' : 'Report summary is unavailable.'}</span>
  if (!summary) return <span className="muted">{locale === 'ru' ? 'Импортированных отчётов пока нет.' : 'No imported reports yet.'}</span>
  const status = locale === 'ru'
    ? ({ ready: 'готово', degraded: 'частично готово', 'not-ready': 'не готово', unknown: 'неизвестно' }[summary.state] ?? 'неизвестно')
    : summary.state
  const importedAt = new Date(summary.importedAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US')
  return <div className="report-summary">
    <InspectorField label={locale === 'ru' ? 'Цель' : 'Target'} value={summary.target} />
    <InspectorField label={locale === 'ru' ? 'Revision' : 'Revision'} value={summary.commitSha} />
    <InspectorField label={locale === 'ru' ? 'Поколение' : 'Generation'} value={summary.generation} />
    <InspectorField label={locale === 'ru' ? 'Реплики' : 'Replicas'} value={`${String(summary.readyReplicas)}/${String(summary.replicaCount)} · ${status}`} />
    <InspectorField label={locale === 'ru' ? 'Операция' : 'Operation'} value={summary.operationId} />
    <InspectorField label={locale === 'ru' ? 'Bundle digest' : 'Bundle digest'} value={summary.bundleDigest} />
    <InspectorField label="CLI" value={summary.cliVersion} />
    <InspectorField label={locale === 'ru' ? 'Импортирован' : 'Imported'} value={importedAt} />
  </div>
}

type JsonObject = Record<string, unknown>
type ResourceCatalogOption = { value: string; label: string }
type ProjectResourceFile = { path: string; kind: string; bytes: number }
const ServiceResourceContext = createContext<{ projectID: string; serviceID: string; resources: ServiceConfigurationResource[]; files: ProjectResourceFile[]; load: (resourceID: string) => Promise<{ items: ResourceCatalogOption[] }>; importCertificate: (resourceID: string) => Promise<string | null>; open: (path: string) => void } | null>(null)
type ServicePeerContextValue = { projectID: string; serviceID: string; services: RuntimeService[]; verify: (targetID: string, contractID: string) => Promise<{ id: string; version: string; contractVersion: string }> }
const ServicePeerContext = createContext<ServicePeerContextValue | null>(null)
function objectValue(value: unknown): JsonObject | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null }
function schemaControl(schema: JsonObject): string {
  const custom = schema['x-studio-control']
  const format = schema.format
  return typeof custom === 'string' ? custom : typeof format === 'string' ? format : typeof schema.type === 'string' ? schema.type : Array.isArray(schema.enum) ? 'select' : ''
}
function ServiceSettingsInspector({ controller, service, locale }: { controller: StudioController; service: RuntimeService; locale: Locale }) {
  const replicas = useStudioStore((state) => runtimeReplicasForService(state.runtimeReplicas, service.id))
  const projectID = useStudioStore((state) => state.workspace?.project?.id ?? '')
  const projectRoot = useStudioStore((state) => state.workspace?.project?.rootPath ?? '')
  const projectServices = useStudioStore((state) => state.workspace?.graph.services ?? [])
  const projectFiles = useStudioStore((state) => state.workspace?.files ?? [])
  const applyRecoveryStatus = useStudioStore((state) => state.applyRecoveryStatus)
  const applyRecoveryOperationId = useStudioStore((state) => state.applyRecoveryOperationId)
  const applyReviewPaths = useStudioStore((state) => state.applyReviewPaths)
  const cliStreamState = useStudioStore((state) => state.cliStreamState)
  const draftKey = configurationDraftKey(projectRoot, service.id)
  const draft = useStudioStore((state) => state.serviceSettingsDrafts[draftKey])
  const updateDraft = useStudioStore((state) => state.updateServiceSettingsDraft)
  const undoStack = draft?.history.undo.length ?? 0
  const redoStack = draft?.history.redo.length ?? 0
  const setDraftError = useStudioStore((state) => state.setServiceSettingsDraftError)
  const [importingSchema, setImportingSchema] = useState(false)
  const [schemaImportError, setSchemaImportError] = useState('')
  const [refreshingSchema, setRefreshingSchema] = useState(false)
  const [schemaRefreshError, setSchemaRefreshError] = useState('')
  const [schemaRefreshReviewOpen, setSchemaRefreshReviewOpen] = useState(false)
  const [schemaPreviewLoading, setSchemaPreviewLoading] = useState(false)
  const [schemaMigrationPreview, setSchemaMigrationPreview] = useState<ServiceSettingsSchemaPreview | null>(null)
  const values = useMemo(() => draft ? mergeConfiguration(draft.base, draft.patch) : {}, [draft])
  const draftReviewPaths = draft ? configurationApplyReviewPaths(draft.patch) : []
  const loadResource = useCallback((resourceID: string) => controller.readServiceResourceCatalog(projectID, service.id, resourceID), [controller, projectID, service.id])
  const importCertificate = useCallback((resourceID: string) => controller.importProjectCertificateResource(projectID, service.id, resourceID), [controller, projectID, service.id])
  const openResource = useCallback((relativePath: string) => {
    const file = projectFiles.find((candidate) => candidate.path === relativePath && candidate.kind === 'file')
    if (file) void controller.openFileExternally(file)
  }, [controller, projectFiles])
  const resourceContext = useMemo(() => ({ projectID, serviceID: service.id, resources: draft?.configurationUI?.resources ?? [], files: projectFiles, load: loadResource, importCertificate, open: openResource }), [projectID, service.id, draft?.configurationUI?.resources, projectFiles, loadResource, importCertificate, openResource])
  const verifyPeer = useCallback((targetID: string, contractID: string) => controller.verifyServicePeerContract(projectID, service.id, targetID, contractID), [controller, projectID, service.id])
  const peerContext = useMemo(() => ({ projectID, serviceID: service.id, services: projectServices, verify: verifyPeer }), [projectID, service.id, projectServices, verifyPeer])
  useEffect(() => {
    if (service.settingsPath && service.settingsSchemaPath) void controller.loadServiceSettingsDraft(service)
  }, [controller, projectRoot, service])
  useEffect(() => { setSchemaRefreshReviewOpen(false); setSchemaMigrationPreview(null) }, [draftKey, draft?.configurationContractState, draft?.configurationContractMismatchKind])
  if (!service.settingsPath || !service.settingsSchemaPath) return <div className="schema-unavailable" role="status">{locale === 'ru' ? 'Для сервиса не задан контракт настроек.' : 'This service does not declare a settings contract.'}</div>
  if (!projectRoot) return <div className="schema-unavailable" role="status">{locale === 'ru' ? 'Нет активного Project.' : 'No active Project.'}</div>
  const loading = !draft || draft.status === 'loading'
  const schema = draft?.schema ?? null
  const saving = draft?.status === 'saving'
  const error = draft?.error ?? ''
  function change(path: string[], value: unknown) {
    try { updateDraft(draftKey, path, value); void controller.persistServiceSettingsDraft(draftKey) }
    catch (reason: unknown) { setDraftError(draftKey, reason instanceof Error ? reason.message : 'Invalid configuration value') }
  }
  if (loading) return <span className="muted">{locale === 'ru' ? 'Загрузка схемы…' : 'Loading schema…'}</span>
  if (!schema) return <div className="schema-unavailable" role="status">
    <span>{error || (locale === 'ru' ? 'Локальная схема настроек отсутствует. Импортируйте контракт из Core через CLI; существующий файл не перезаписывается.' : 'The Project settings schema is missing. Import the contract from Core through the CLI; an existing file will not be overwritten.')}</span>
    {schemaImportError && <span className="inline-error" role="alert">{schemaImportError}</span>}
    <button type="button" className="secondary-button compact" disabled={importingSchema} onClick={() => {
      setImportingSchema(true)
      setSchemaImportError('')
      void controller.importServiceSettingsSchema(service).catch((reason: unknown) => {
        setSchemaImportError(reason instanceof Error && reason.message ? reason.message : locale === 'ru' ? 'Не удалось импортировать контракт' : 'Could not import the contract')
      }).finally(() => { setImportingSchema(false) })
    }}>{importingSchema ? (locale === 'ru' ? 'Получаю контракт…' : 'Fetching contract…') : (locale === 'ru' ? 'Импортировать контракт из Core' : 'Import contract from Core')}</button>
    {draft.status === 'error' && <><button type="button" className="secondary-button compact" onClick={() => { void controller.loadServiceSettingsDraft(service) }}>{locale === 'ru' ? 'Повторить' : 'Retry'}</button><button type="button" className="secondary-button compact" onClick={() => { void controller.discardServiceSettingsDraft(draftKey, service) }}>{locale === 'ru' ? 'Загрузить из файла' : 'Reload from file'}</button></>}
  </div>
  const renderSchema = effectiveConfigurationSchema(schema, schema, values) ?? schema
  const properties = objectValue(renderSchema.properties) ?? {}
  const required = Array.isArray(renderSchema.required) ? renderSchema.required.filter((key): key is string => typeof key === 'string') : []
  const hasChanges = Object.keys(draft.patch).length > 0
  const schemaMatched = draft.configurationContractState === 'matched'
  const schemaMismatch = draft.configurationContractState === 'mismatch'
  const editable = !saving && !draft.refreshingContract && draft.status !== 'conflict' && !schemaMismatch
  const uiGroups = draft.configurationUI?.groups ?? []
  const fieldHints = new Map<string, ServiceConfigurationUIField>()
  for (const group of uiGroups) for (const field of group.fields) fieldHints.set(field.path, field)
  const explicitGroups = uiGroups.map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !field.segments.includes('*') && field.segments.length > 0 && !serviceInspectorPathIsHidden(service.id, field.segments))
      .map((field) => ({ field, schema: schemaAtPointer(schema, field.segments) }))
      .filter((entry): entry is { field: ServiceConfigurationUIField; schema: JsonObject } => Boolean(entry.schema && schemaControl(entry.schema) !== 'object' && !sensitiveSchema(entry.schema, entry.field.segments.at(-1)) && configurationSchemaRenderable(schema, entry.schema, configurationValueAtPath(values, entry.field.segments)))),
  })).filter((group) => group.fields.length > 0)
  const explicitPaths = new Set(explicitGroups.flatMap((group) => group.fields.map(({ field }) => field.path)))
  for (const path of serviceInspectorHiddenSettingsPaths(service.id)) explicitPaths.add(path)
  return <ServiceResourceContext.Provider value={resourceContext}><ServicePeerContext.Provider value={peerContext}><div className="schema-settings">
    {applyRecoveryStatus !== 'none' && <p className="inline-error" role="status">{applyRecoveryOperationId ? (locale === 'ru' ? 'Core operation ещё не сверена. Сначала проверьте её состояние:' : 'The Core operation is not reconciled yet. Check its state before retrying:') : applyRecoveryStatus === 'applying' ? (locale === 'ru' ? 'Применение не подтверждено. Проверьте Core и явно подтвердите повторное применение.' : 'Apply completion is unconfirmed. Check Core and explicitly confirm a retry.') : (locale === 'ru' ? 'Изменения Project не подтверждены в Core. Проверьте состояние и явно подтвердите применение.' : 'Project changes are not confirmed in Core. Check runtime state and explicitly confirm apply.')}{applyRecoveryOperationId && <> <code>{applyRecoveryOperationId}</code> <button type="button" className="secondary-button compact" disabled={cliStreamState !== 'idle'} onClick={() => { void controller.reconcileApplyRecovery() }}>{cliStreamState !== 'idle' ? (locale === 'ru' ? 'Проверяю…' : 'Checking…') : (locale === 'ru' ? 'Проверить операцию' : 'Check operation')}</button></>}</p>}
    {draft.configurationContractState === 'pending' && <p className="muted" role="status">{locale === 'ru' ? 'Сверяем схему Project с live-контрактом сервиса через Core…' : 'Comparing the Project schema with the live service contract through Core…'}</p>}
    {schemaMismatch && <div className="inline-error" role="alert">
      <p>{draft.configurationContractMismatchKind === 'provenance'
        ? (locale === 'ru' ? 'Live-регистрация Core не совпадает с привязкой сервиса в Project. Изменения заблокированы; перезапуск сам по себе не исправляет provenance. Проверьте Core binary и target в настройках Local Core, затем повторно проверьте контракт.' : 'Core’s live registration does not match the Project service binding. Edits are blocked; restarting Core alone cannot repair provenance. Review the Core binary and target in Local Core settings, then re-check the contract.')
        : (locale === 'ru' ? 'Live-схема настроек сервиса отличается от схемы в Project. Редактирование и применение приостановлены; изменения сохранены.' : 'The live service settings schema differs from the Project schema. Editing and apply are paused; changes are preserved.')}</p>
      {draft.configurationContractDifferences.length > 0 && <small>{draft.configurationContractMismatchKind === 'provenance' ? (locale === 'ru' ? 'Проверки release: ' : 'Release checks: ') : (locale === 'ru' ? 'Изменённые элементы схемы: ' : 'Changed schema paths: ')}{draft.configurationContractDifferences.slice(0, 8).join(', ')}</small>}
      <button type="button" className="secondary-button compact" disabled={draft.refreshingContract} onClick={() => { void controller.refreshServiceSettingsContract(service) }}>{draft.refreshingContract ? (locale === 'ru' ? 'Проверка…' : 'Checking…') : (locale === 'ru' ? 'Перепроверить Core и контракт' : 'Re-check Core and contract')}</button>
      {draft.configurationContractMismatchKind === 'schema' && !schemaRefreshReviewOpen && <button type="button" className="secondary-button compact" disabled={refreshingSchema || schemaPreviewLoading || draft.refreshingContract} onClick={() => {
        setSchemaRefreshError('')
        setSchemaPreviewLoading(true)
        void controller.previewServiceSettingsSchema(service).then((preview) => { setSchemaMigrationPreview(preview); setSchemaRefreshReviewOpen(true) }).catch((reason: unknown) => { setSchemaRefreshError(reason instanceof Error && reason.message ? reason.message : locale === 'ru' ? 'Не удалось проверить новую схему' : 'Could not preview the new schema') }).finally(() => { setSchemaPreviewLoading(false) })
      }}>{schemaPreviewLoading ? (locale === 'ru' ? 'Проверяю значения…' : 'Checking values…') : (locale === 'ru' ? 'Просмотреть обновление схемы…' : 'Review schema update…')}</button>}
      {draft.configurationContractMismatchKind === 'schema' && schemaRefreshReviewOpen && schemaMigrationPreview && <section className="schema-migration-preview" aria-label={locale === 'ru' ? 'Предпросмотр обновления схемы' : 'Schema update preview'}>
        <strong>{locale === 'ru' ? 'Предпросмотр обновления' : 'Update preview'}</strong>
        {schemaMigrationPreview.migrationRequired
          ? <>
            <p>{locale === 'ru'
              ? `Детерминированная миграция настроек ${String(schemaMigrationPreview.migrationFromVersion)} → ${String(schemaMigrationPreview.migrationToVersion)}: изменится только /schemaVersion. Неизвестные и несовместимые поля сохраняются и продолжат блокировать применение до исправления.`
              : `Deterministic settings migration ${String(schemaMigrationPreview.migrationFromVersion)} → ${String(schemaMigrationPreview.migrationToVersion)}: only /schemaVersion changes. Unknown or incompatible fields are retained and will keep blocking apply until fixed.`}</p>
            <p>{locale === 'ru' ? 'Точные исходные байты настроек и прежней схемы сохраняются в Project для восстановления:' : 'Exact source bytes for settings and the previous schema are saved in the Project for recovery:'} <code>{schemaMigrationPreview.recoveryCopyPath}</code> · <code>{schemaMigrationPreview.recoverySchemaCopyPath}</code></p>
          </>
          : <p>{locale === 'ru' ? 'Будет заменена только JSON Schema в Project актуальным контрактом через CLI → Core. Значения настроек и текущие изменения не переписываются.' : 'Only the Project JSON Schema will be replaced with the current CLI → Core contract. Settings values and current edits are not rewritten.'}</p>}
        <p className={schemaMigrationPreview.valuesCompatible ? 'schema-preview-compatible' : 'schema-preview-incompatible'} role="status">{schemaMigrationPreview.valuesCompatible
          ? (schemaMigrationPreview.migrationRequired
            ? (locale === 'ru' ? 'Настройки после миграции проходят новую схему.' : 'The migrated settings satisfy the new schema.')
            : (locale === 'ru' ? 'Текущие настройки проходят новую схему.' : 'Current settings satisfy the new schema.'))
          : (schemaMigrationPreview.migrationRequired
            ? (locale === 'ru' ? 'Настройки после миграции не проходят новую схему. Значения останутся в Project; исправьте ошибки до применения.' : 'The migrated settings do not satisfy the new schema. Values remain in the Project; fix validation errors before applying.')
            : (locale === 'ru' ? 'Текущие настройки не проходят новую схему. После обновления исправьте ошибки до применения.' : 'Current settings do not satisfy the new schema. Fix validation errors after updating before applying.'))}</p>
        <small>{locale === 'ru' ? 'Контракт: ' : 'Contract: '}<code>{schemaMigrationPreview.schemaDigest.slice(0, 23)}…</code></small>
        {configurationSchemaDifferencePaths(schema, schemaMigrationPreview.schemaJson).length > 0 && <ul>{configurationSchemaDifferencePaths(schema, schemaMigrationPreview.schemaJson).slice(0, 12).map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
        {schemaRefreshError && <span className="inline-error" role="alert">{schemaRefreshError}</span>}
        <div className="toolbar-actions">
          <button type="button" className="secondary-button compact" disabled={refreshingSchema} onClick={() => { setSchemaRefreshReviewOpen(false); setSchemaMigrationPreview(null) }}>{locale === 'ru' ? 'Отмена' : 'Cancel'}</button>
          <button type="button" className="primary-button compact" disabled={refreshingSchema || draft.refreshingContract} onClick={() => {
            setRefreshingSchema(true)
            setSchemaRefreshError('')
            void controller.refreshServiceSettingsSchema(service, schemaMigrationPreview).then(() => { setSchemaRefreshReviewOpen(false); setSchemaMigrationPreview(null) }).catch((reason: unknown) => { setSchemaRefreshError(reason instanceof Error && reason.message ? reason.message : locale === 'ru' ? 'Не удалось обновить схему из Core' : 'Could not refresh schema from Core') }).finally(() => { setRefreshingSchema(false) })
          }}>{refreshingSchema ? (locale === 'ru' ? 'Обновляю…' : 'Updating…') : (locale === 'ru' ? 'Подтвердить замену схемы' : 'Confirm schema update')}</button>
        </div>
      </section>}
    </div>}
    {draft.configurationContractState === 'unavailable' && <div className="muted" role="status">{locale === 'ru' ? 'Core не предоставил live-схему. Настройки можно сохранить в файл проекта; применение приостановлено.' : 'Core did not provide the live schema. Settings can be saved to the project file; apply is paused.'}<button type="button" className="secondary-button compact" disabled={draft.refreshingContract} onClick={() => { void controller.refreshServiceSettingsContract(service) }}>{draft.refreshingContract ? (locale === 'ru' ? 'Проверка…' : 'Checking…') : (locale === 'ru' ? 'Повторить проверку' : 'Retry verification')}</button></div>}
    {explicitGroups.map((group) => <fieldset className="schema-object schema-ui-group" key={group.id}>
      <legend>{locale === 'ru' ? group.title.ru : group.title.en}</legend>
      {group.description && <small>{locale === 'ru' ? group.description.ru : group.description.en}</small>}
      {group.fields.map(({ field, schema: fieldSchema }) => <SchemaField
        key={field.path}
        name={locale === 'ru' ? field.label.ru : field.label.en}
        schema={fieldSchema}
        value={configurationValueAtPath(values, field.segments)}
        required={schemaPathRequired(schema, field.segments)}
        description={field.help ? (locale === 'ru' ? field.help.ru : field.help.en) : ''}
        unit={field.unit ? (locale === 'ru' ? field.unit.ru : field.unit.en) : ''}
        widget={field.widget}
        path={field.segments}
        configurationUI={draft.configurationUI}
        configurationUIPath={field.segments}
        onChange={change}
        locale={locale}
        disabled={!editable}
      />)}
    </fieldset>)}
    <SchemaProperties rootSchema={schema} objectSchema={schema} properties={properties} values={values} path={[]} configurationUIPath={[]} configurationUI={draft.configurationUI} required={required} onChange={change} locale={locale} disabled={!editable} excludedPaths={explicitPaths} fieldHints={fieldHints} />
    {draft.status === 'dirty' && <p className="muted" role="status">{schemaMatched ? (draftReviewPaths.length > 0
      ? (locale === 'ru' ? 'После сохранения изменения маршрутов, слушателей или безопасности останутся в Project до вашего подтверждения.' : 'After saving, route, listener, or security changes stay in the Project until you confirm them.')
      : (locale === 'ru' ? 'После 800 мс без изменений настройки сохранятся в файл проекта и отправятся в Core.' : 'After 800 ms without changes, settings are saved to the project file and sent to Core.')) : (locale === 'ru' ? 'Настройки ожидают проверки live-схемы.' : 'Settings are waiting for live schema verification.')}</p>}
    {applyReviewPaths.length > 0 && <section className="apply-review" role="alert">
      <strong>{locale === 'ru' ? 'Подтвердите изменения перед применением' : 'Review changes before applying'}</strong>
      <p>{locale === 'ru' ? 'Project уже сохранён. Эти публичные или чувствительные параметры ещё не отправлены в Core:' : 'The Project is saved. These public or security-sensitive settings have not been sent to Core:'}</p>
      <ul>{applyReviewPaths.slice(0, 24).map((path) => <li key={path}><code>{path}</code></li>)}</ul>
      {applyReviewPaths.length > 24 && <small>{locale === 'ru' ? `И ещё ${String(applyReviewPaths.length - 24)} изменений` : `And ${String(applyReviewPaths.length - 24)} more changes`}</small>}
      {draft.status === 'clean' && schemaMatched && !applyRecoveryOperationId && <button type="button" className="secondary-button compact" disabled={cliStreamState !== 'idle'} onClick={() => { void controller.applyServiceSettings(draftKey) }}>{locale === 'ru' ? 'Подтвердить и применить' : 'Confirm & apply'}</button>}
    </section>}
    {draft.status === 'clean' && <p className="muted" role="status">{applyRecoveryStatus === 'applying' ? (locale === 'ru' ? 'Применяется… Файл проекта сохранён.' : 'Applying… Project file saved.') : projectSettingsApplied(draft.configurationDigest ?? '', replicas) ? (locale === 'ru' ? 'Применено. Конфигурация в файле совпадает с активной.' : 'Applied. The project file matches the active configuration.') : (locale === 'ru' ? 'Не применено. Файл проекта сохранён; активная конфигурация пока отличается или не подтверждена.' : 'Not applied. Project file saved; the active configuration differs or has not been confirmed.')}</p>}
    {draft.status === 'conflict' && <p className="inline-error" role="alert">{locale === 'ru' ? 'Файл настроек изменился во внешнем редакторе. Текущие изменения сохранены; загрузите файл заново, чтобы продолжить с его версией.' : 'The settings file changed in an external editor. Current edits are retained; reload the file to continue with its version.'}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="inspector-actions">
      <button type="button" className="icon-button small" title={locale === 'ru' ? 'Отменить изменение' : 'Undo change'} aria-label={locale === 'ru' ? 'Отменить изменение' : 'Undo change'} disabled={!editable || undoStack === 0} onClick={() => { void controller.undoServiceSettingsDraft(draftKey) }}><Undo2 size={15} /></button>
      <button type="button" className="icon-button small" title={locale === 'ru' ? 'Повторить изменение' : 'Redo change'} aria-label={locale === 'ru' ? 'Повторить изменение' : 'Redo change'} disabled={!editable || redoStack === 0} onClick={() => { void controller.redoServiceSettingsDraft(draftKey) }}><Redo2 size={15} /></button>
      <button type="button" className="primary-button compact" disabled={!hasChanges || saving || draft.refreshingContract || draft.status === 'conflict' || schemaMismatch} onClick={() => { void controller.saveServiceSettingsDraft(draftKey) }}>{saving ? (locale === 'ru' ? 'Сохранение…' : 'Saving…') : draft.refreshingContract ? (locale === 'ru' ? 'Проверка…' : 'Checking…') : (schemaMatched && draftReviewPaths.length > 0 ? (locale === 'ru' ? 'Сохранить для проверки' : 'Save for review') : (schemaMatched ? (locale === 'ru' ? 'Сохранить и применить сейчас' : 'Save & apply now') : (locale === 'ru' ? 'Сохранить в Project' : 'Save to Project')))}</button>
      {draft.status === 'clean' && schemaMatched && !applyRecoveryOperationId && applyReviewPaths.length === 0 && <>
        <button type="button" className="secondary-button compact" onClick={() => { void controller.applyServiceSettings(draftKey) }}>{applyRecoveryStatus !== 'none' ? (locale === 'ru' ? 'Подтвердить и применить' : 'Confirm & apply') : (locale === 'ru' ? 'Повторить применение' : 'Retry apply')}</button>
        {applyRecoveryStatus === 'confirmation-required' && <button type="button" className="secondary-button compact" disabled={cliStreamState !== 'idle'} onClick={() => { void controller.retryFailedServiceSettings(draftKey) }}>{locale === 'ru' ? 'Повторить неудавшееся применение' : 'Retry failed apply'}</button>}
      </>}
      <button type="button" className="secondary-button compact" disabled={!hasChanges || saving} onClick={() => { void controller.discardServiceSettingsDraft(draftKey, service) }}>{locale === 'ru' ? 'Загрузить из файла' : 'Reload from file'}</button>
    </div>
  </div></ServicePeerContext.Provider></ServiceResourceContext.Provider>
}

function SchemaProperties({ rootSchema, objectSchema, properties, values, path, configurationUIPath, configurationUI, required, onChange, locale, disabled, excludedPaths = new Set<string>(), fieldHints = new Map<string, ServiceConfigurationUIField>() }: { rootSchema: JsonObject; objectSchema?: JsonObject; properties: JsonObject; values: JsonObject; path: string[]; configurationUIPath: string[]; configurationUI: ServiceConfigurationUI | null; required: string[]; onChange: (path: string[], value: unknown) => void; locale: Locale; disabled: boolean; excludedPaths?: ReadonlySet<string>; fieldHints?: ReadonlyMap<string, ServiceConfigurationUIField> }) {
  const mapSchema = objectSchema ?? { type: 'object', properties }
  return <div className="schema-properties">{Object.entries(properties).map(([name, rawSchema]) => {
    const schema = objectValue(rawSchema)
    if (!schema) return <div className="schema-unavailable" key={name}>{name}: unsupported schema</div>
    const value = values[name]
    const fieldPath = [...path, name]
    const hintPath = [...configurationUIPath, name]
    const fieldKey = configurationUIFieldKey(fieldPath)
    if (isExcludedInspectorPath(fieldKey, excludedPaths)) return null
    const hint = matchServiceConfigurationUIField(configurationUI, hintPath) ?? fieldHints.get(fieldKey)
    const title = hint ? (locale === 'ru' ? hint.label.ru : hint.label.en) : typeof schema.title === 'string' ? schema.title : name
    const description = hint?.help ? (locale === 'ru' ? hint.help.ru : hint.help.en) : typeof schema.description === 'string' ? schema.description : ''
    if (!configurationSchemaRenderable(rootSchema, schema, value)) return <div className="schema-unavailable" key={name} role="status"><strong>{title}</strong><span>{locale === 'ru' ? 'Этот контракт содержит неподдерживаемую форму данных; поле оставлено без изменений. Остальные поля доступны.' : 'This contract uses an unsupported data shape; this field is left unchanged. Other fields remain available.'}</span></div>
    const variants = configurationSchemaVariants(rootSchema, schema)
    if (variants) return <SchemaVariantField key={name} rootSchema={rootSchema} schema={schema} variants={variants} name={title} value={value} path={fieldPath} configurationUI={configurationUI} configurationUIPath={hintPath} onChange={onChange} locale={locale} disabled={disabled} />
    const viewSchema = effectiveConfigurationSchema(rootSchema, schema, value) ?? schema
    const control = schemaControl(viewSchema)
    const sensitive = sensitiveSchema(viewSchema, name)
    if (sensitive) return <div className="schema-field secret-field" key={name}><strong>{title}</strong><span>{locale === 'ru' ? 'Секрет управляется вне Studio и не раскрывается.' : 'Secret is managed outside Studio and is never shown.'}</span></div>
    if (viewSchema.readOnly === true || Object.hasOwn(viewSchema, 'const')) return <div className="schema-field" key={name}><strong>{title}</strong><code>{displayValue(viewSchema.const ?? value)}</code></div>
    if (control === 'object' && viewSchema['x-studio-json-document'] !== true && viewSchema['x-studio-json-value'] !== true) {
      const nestedProperties = objectValue(viewSchema.properties) ?? {}
      if (!hasVisibleSchemaFields(nestedProperties, fieldPath, excludedPaths) && !hasTypedConfigurationMap(viewSchema)) return null
      return <fieldset className="schema-object" key={name}><legend>{title}{required.includes(name) ? ' *' : ''}</legend>{description && <small>{description}</small>}<SchemaProperties rootSchema={rootSchema} objectSchema={viewSchema} properties={nestedProperties} values={objectValue(value) ?? {}} path={fieldPath} configurationUIPath={hintPath} configurationUI={configurationUI} required={Array.isArray(viewSchema.required) ? viewSchema.required.filter((entry): entry is string => typeof entry === 'string') : []} onChange={onChange} locale={locale} disabled={disabled} excludedPaths={excludedPaths} fieldHints={fieldHints} /></fieldset>
    }
    return <SchemaField key={name} name={title} schema={viewSchema} value={value} required={required.includes(name)} description={description} unit={hint?.unit ? (locale === 'ru' ? hint.unit.ru : hint.unit.en) : ''} widget={hint?.widget} path={fieldPath} configurationUI={configurationUI} configurationUIPath={hintPath} onChange={onChange} locale={locale} disabled={disabled} rootSchema={rootSchema} />
  })}{hasTypedConfigurationMap(mapSchema) && <ConfigurationMapEntries rootSchema={rootSchema} objectSchema={mapSchema} values={values} path={path} configurationUI={configurationUI} configurationUIPath={configurationUIPath} onChange={onChange} locale={locale} disabled={disabled} />}</div>
}

function hasTypedConfigurationMap(schema: JsonObject): boolean {
  return schema.type === 'object' && Boolean(objectValue(schema.additionalProperties)) &&
    schema.patternProperties === undefined && schema.propertyNames === undefined && schema.dependentSchemas === undefined
}

function ConfigurationMapEntries({ rootSchema, objectSchema, values, path, configurationUI, configurationUIPath, onChange, locale, disabled }: { rootSchema: JsonObject; objectSchema: JsonObject; values: JsonObject; path: string[]; configurationUI: ServiceConfigurationUI | null; configurationUIPath: string[]; onChange: (path: string[], value: unknown) => void; locale: Locale; disabled: boolean }) {
  const [newKey, setNewKey] = useState('')
  const additionalSchema = objectValue(objectSchema.additionalProperties)
  if (!additionalSchema || configurationSchemaProtected(rootSchema, additionalSchema)) return null
  const properties = objectValue(objectSchema.properties) ?? {}
  const allEntries = Object.entries(values).filter(([key]) => !Object.hasOwn(properties, key))
  const entries = allEntries.filter(([key, value]) => safeConfigurationMapKey(key) && configurationSchemaRenderable(rootSchema, additionalSchema, value))
  const minProperties = typeof objectSchema.minProperties === 'number' && Number.isSafeInteger(objectSchema.minProperties) ? objectSchema.minProperties : 0
  const maxProperties = typeof objectSchema.maxProperties === 'number' && Number.isSafeInteger(objectSchema.maxProperties) ? objectSchema.maxProperties : Number.POSITIVE_INFINITY
  const canAdd = !disabled && Object.keys(values).length < maxProperties
  function addEntry() {
    const key = newKey.trim()
    if (!canAdd || !safeConfigurationMapKey(key) || Object.hasOwn(values, key) || Object.hasOwn(properties, key)) return
    const value = createConfigurationSchemaValue(rootSchema, additionalSchema)
    onChange([...path, key], value)
    setNewKey('')
  }
  const hiddenCount = allEntries.length - entries.length
  return <section className="schema-map-field">
    <div className="schema-map-heading"><strong>{locale === 'ru' ? 'Дополнительные параметры' : 'Additional entries'}</strong><span>{entries.length}</span></div>
    {hiddenCount > 0 && <small className="array-protected" role="status">{locale === 'ru' ? 'Часть ключей скрыта или не поддерживается текущим контрактом.' : 'Some keys are hidden or unsupported by the current contract.'}</small>}
    {entries.map(([key, value]) => {
      const entryPath = [...path, key]
      const entryUIPath = [...configurationUIPath, key]
      const entrySchema = effectiveConfigurationSchema(rootSchema, additionalSchema, value) ?? additionalSchema
      const variants = configurationSchemaVariants(rootSchema, entrySchema)
      const remove = () => { onChange(path, configurationMapOperationRequest({ op: 'remove', key })); }
      const removeDisabled = disabled || Object.keys(values).length <= minProperties
      if (variants) return <div className="schema-map-entry" key={key}><SchemaVariantField rootSchema={rootSchema} schema={entrySchema} variants={variants} name={key} value={value} path={entryPath} configurationUI={configurationUI} configurationUIPath={entryUIPath} onChange={onChange} locale={locale} disabled={disabled} /><button type="button" className="icon-button small danger" title={locale === 'ru' ? 'Удалить ключ' : 'Remove key'} aria-label={locale === 'ru' ? `Удалить ключ ${key}` : `Remove key ${key}`} disabled={removeDisabled} onClick={remove}><Trash2 size={13} /></button></div>
      if (schemaControl(entrySchema) === 'object') {
        const nestedProperties = objectValue(entrySchema.properties) ?? {}
        return <fieldset className="schema-object schema-map-entry" key={key}><legend>{key}<button type="button" className="icon-button small danger" title={locale === 'ru' ? 'Удалить ключ' : 'Remove key'} aria-label={locale === 'ru' ? `Удалить ключ ${key}` : `Remove key ${key}`} disabled={removeDisabled} onClick={remove}><Trash2 size={13} /></button></legend><SchemaProperties rootSchema={rootSchema} objectSchema={entrySchema} properties={nestedProperties} values={objectValue(value) ?? {}} path={entryPath} configurationUIPath={entryUIPath} configurationUI={configurationUI} required={stringList(entrySchema.required)} onChange={onChange} locale={locale} disabled={disabled} /></fieldset>
      }
      return <div className="schema-map-entry" key={key}><SchemaField name={key} schema={entrySchema} value={value} required={false} description={typeof entrySchema.description === 'string' ? entrySchema.description : ''} path={entryPath} configurationUI={configurationUI} configurationUIPath={entryUIPath} onChange={onChange} locale={locale} disabled={disabled} rootSchema={rootSchema} /><button type="button" className="icon-button small danger" title={locale === 'ru' ? 'Удалить ключ' : 'Remove key'} aria-label={locale === 'ru' ? `Удалить ключ ${key}` : `Remove key ${key}`} disabled={removeDisabled} onClick={remove}><Trash2 size={13} /></button></div>
    })}
    <div className="schema-map-add"><input aria-label={locale === 'ru' ? 'Новый ключ' : 'New key'} placeholder={locale === 'ru' ? 'Новый ключ' : 'New key'} value={newKey} maxLength={128} disabled={!canAdd} onChange={(event) => { setNewKey(event.target.value); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEntry(); } }} /><button type="button" className="secondary-button compact" disabled={!canAdd || !safeConfigurationMapKey(newKey.trim()) || Object.hasOwn(values, newKey.trim()) || Object.hasOwn(properties, newKey.trim())} onClick={addEntry}><Plus size={14} />{locale === 'ru' ? 'Добавить' : 'Add'}</button></div>
  </section>
}

function SchemaVariantField({ rootSchema, schema, variants, name, value, path, configurationUI, configurationUIPath, onChange, locale, disabled }: { rootSchema: JsonObject; schema: JsonObject; variants: NonNullable<ReturnType<typeof configurationSchemaVariants>>; name: string; value: unknown; path: string[]; configurationUI: ServiceConfigurationUI | null; configurationUIPath: string[]; onChange: (path: string[], value: unknown) => void; locale: Locale; disabled: boolean }) {
  const selected = selectedConfigurationVariant(rootSchema, variants, value)
  const safeVariants = variants.filter((variant) => !configurationSchemaProtected(rootSchema, variant.schema))
  const protectedVariant = safeVariants.length === 0
  const hasProtectedVariants = safeVariants.length !== variants.length
  function selectVariant(rawIndex: string) {
    const index = Number(rawIndex)
    if (!Number.isInteger(index)) return
    const next = configurationVariantValue(rootSchema, schema, value, index)
    if (!next.ok) return
    const currentObject = objectValue(value)
    const nextObject = objectValue(next.value)
    const discarded = currentObject && nextObject ? Object.keys(currentObject).filter((key) => !Object.hasOwn(nextObject, key)) : []
    if (discarded.length > 0) {
      const message = locale === 'ru'
        ? `Смена варианта удалит поля: ${discarded.join(', ')}. Продолжить?`
        : `Switching the variant removes fields: ${discarded.join(', ')}. Continue?`
      if (!window.confirm(message)) return
    }
    onChange(path, next.value)
  }
  const activeSchema = selected ? effectiveConfigurationSchema(rootSchema, selected.schema, value) ?? selected.schema : null
  const activeProperties = objectValue(activeSchema?.properties)
  const activeValue = objectValue(value) ?? {}
  return <fieldset className="schema-object schema-variant">
    <legend>{name}</legend>
    <label className="schema-field"><span>{locale === 'ru' ? 'Вариант' : 'Variant'}</span><select value={selected ? String(selected.index) : ''} disabled={disabled || protectedVariant} onChange={(event) => { selectVariant(event.target.value) }}>
      <option value="">{locale === 'ru' ? 'Выберите вариант…' : 'Select a variant…'}</option>
      {variants.map((variant) => <option key={variant.index} value={String(variant.index)} disabled={configurationSchemaProtected(rootSchema, variant.schema)}>{variant.label}</option>)}
    </select></label>
    {protectedVariant && <small className="schema-unavailable" role="status">{locale === 'ru' ? 'Все варианты требуют скрытых или управляемых вне Studio значений.' : 'Every variant requires values that are hidden or managed outside Studio.'}</small>}
    {!protectedVariant && hasProtectedVariants && <small className="array-protected" role="status">{locale === 'ru' ? 'Варианты со скрытыми или внешними значениями недоступны.' : 'Variants containing hidden or externally managed values are unavailable.'}</small>}
    {selected && activeSchema?.type === 'object' && activeProperties && <SchemaProperties rootSchema={rootSchema} objectSchema={activeSchema} properties={activeProperties} values={activeValue} path={path} configurationUIPath={configurationUIPath} configurationUI={configurationUI} required={Array.isArray(activeSchema.required) ? activeSchema.required.filter((entry): entry is string => typeof entry === 'string') : []} onChange={onChange} locale={locale} disabled={disabled} />}
    {selected && activeSchema && activeSchema.type !== 'object' && <SchemaField name={name} schema={activeSchema} value={value} required path={path} configurationUI={configurationUI} configurationUIPath={configurationUIPath} onChange={onChange} locale={locale} disabled={disabled} rootSchema={rootSchema} description="" />}
  </fieldset>
}

function SchemaField({ name, schema, value, required, description, unit, widget, path, configurationUI, configurationUIPath, onChange, locale, disabled, rootSchema }: { name: string; schema: JsonObject; value: unknown; required: boolean; description: string; unit?: string; widget?: ServiceConfigurationUIField['widget']; path: string[]; configurationUI: ServiceConfigurationUI | null; configurationUIPath: string[]; onChange: (path: string[], value: unknown) => void; locale: Locale; disabled: boolean; rootSchema?: JsonObject }) {
  const resourceContext = useContext(ServiceResourceContext)
  const peerContext = useContext(ServicePeerContext)
  const resourceHint = widget === 'resource' ? matchServiceConfigurationUIField(configurationUI, configurationUIPath) : null
  const peerHint = widget === 'peer' ? matchServiceConfigurationUIField(configurationUI, configurationUIPath) : null
  const [resourceState, setResourceState] = useState<{ loading: boolean; error: boolean; items: ResourceCatalogOption[] }>({ loading: false, error: false, items: [] })
  const [resourceRetry, setResourceRetry] = useState(0)
  const [resourceImporting, setResourceImporting] = useState(false)
  const [resourceImportError, setResourceImportError] = useState(false)
  useEffect(() => {
    if (widget !== 'resource' || !resourceHint?.resourceId || !resourceContext) {
      setResourceState({ loading: false, error: false, items: [] })
      return
    }
    let cancelled = false
    setResourceState({ loading: true, error: false, items: [] })
    void resourceContext.load(resourceHint.resourceId).then(({ items }) => {
      if (!cancelled) setResourceState({ loading: false, error: false, items })
    }).catch(() => {
      if (!cancelled) setResourceState({ loading: false, error: true, items: [] })
    })
    return () => { cancelled = true }
  }, [widget, resourceHint?.resourceId, resourceContext, resourceRetry])
  const control = configurationWidgetControl(widget, schema)
  const title = `${name}${required ? ' *' : ''}`
  const enumValues = Array.isArray(schema.enum) ? schema.enum : 'const' in schema ? [schema.const] : null
  const numeric = control === 'number' || control === 'integer' || control === 'size' || control === 'slider'
  const [numericText, setNumericText] = useState(() => schemaScalarValue(value ?? schema.default ?? ''))
  const [numericError, setNumericError] = useState('')
  const allowAnyJSONValue = schema['x-studio-json-value'] === true || Object.keys(schema).length === 0
  const [jsonDocumentText, setJSONDocumentText] = useState(() => formatJSONDocument(value, allowAnyJSONValue))
  const [jsonDocumentError, setJSONDocumentError] = useState('')
  useEffect(() => {
    if (!numeric) return
    setNumericText(schemaScalarValue(value ?? schema.default ?? ''))
    setNumericError('')
  }, [numeric, schema.default, value])
  useEffect(() => {
    const isJSONDocument = schema['x-studio-json-document'] === true
    const isJSONValue = allowAnyJSONValue
    if (!isJSONDocument && !isJSONValue) return
    setJSONDocumentText(formatJSONDocument(value, isJSONValue))
    setJSONDocumentError('')
  }, [allowAnyJSONValue, schema['x-studio-json-document'], value])
  function changeNumeric(raw: string) {
    setNumericText(raw)
    const result = parseConfigurationNumber(raw, schema)
    if (result.valid) {
      setNumericError('')
      onChange(path, result.value)
      return
    }
    const messages: Record<Exclude<typeof result, { valid: true }>['reason'], { ru: string; en: string }> = {
      empty: { ru: 'Введите число.', en: 'Enter a number.' },
      number: { ru: 'Некорректное число.', en: 'Enter a valid number.' },
      integer: { ru: 'Введите целое число в поддерживаемом диапазоне.', en: 'Enter a safe whole number.' },
      minimum: { ru: `Минимум: ${String(schema.minimum)}.`, en: `Minimum: ${String(schema.minimum)}.` },
      exclusiveMinimum: { ru: `Значение должно быть больше ${String(schema.exclusiveMinimum)}.`, en: `Value must be greater than ${String(schema.exclusiveMinimum)}.` },
      maximum: { ru: `Максимум: ${String(schema.maximum)}.`, en: `Maximum: ${String(schema.maximum)}.` },
      exclusiveMaximum: { ru: `Значение должно быть меньше ${String(schema.exclusiveMaximum)}.`, en: `Value must be less than ${String(schema.exclusiveMaximum)}.` },
      multipleOf: { ru: `Значение должно быть кратно ${String(schema.multipleOf)}.`, en: `Value must be a multiple of ${String(schema.multipleOf)}.` },
    }
    setNumericError(messages[result.reason][locale])
  }
  if (widget === 'resource') {
    const resource = resourceHint?.resourceId ? resourceContext?.resources.find((entry) => entry.id === resourceHint.resourceId) : undefined
    if (!resource || !supportsServiceResourceCatalog(resource.provider)) return <div className="schema-field"><span>{title}</span><span className="schema-unavailable" role="status">{locale === 'ru' ? 'Источник каталога ресурсов пока не поддерживается.' : 'This resource catalog provider is not available yet.'}</span>{description && <small>{description}</small>}</div>
    if (resourceState.error || !resourceContext) return <div className="schema-field"><span>{title}</span><span className="schema-unavailable" role="status">{resource.provider === 'project' ? (locale === 'ru' ? 'Каталог ресурсов Project недоступен.' : 'The Project resource catalog is unavailable.') : (locale === 'ru' ? 'Каталог недоступен через Core. Проверьте runtime.' : 'The Core-backed catalog is unavailable. Check runtime.')}</span><button type="button" className="secondary-button compact" disabled={!resourceContext} onClick={() => { setResourceRetry((attempt) => attempt + 1) }}>{locale === 'ru' ? 'Повторить' : 'Retry'}</button>{description && <small>{description}</small>}</div>
    const current = typeof value === 'string' ? value : ''
    const hasCurrent = current !== '' && resourceState.items.some((item) => item.value === current)
    const canOpen = projectResourceCanOpen(resource.provider, resource.kind, current, resourceState.items, resourceContext.files)
    const canImportCertificate = projectCertificateCanImport(resource.provider, resource.kind)
    return <div className="schema-field"><label><span>{title}</span><select disabled={disabled || resourceState.loading || resourceImporting} value={current} onChange={(event) => { onChange(path, event.target.value) }}><option value="">{resourceState.loading ? (locale === 'ru' ? 'Загрузка…' : 'Loading…') : resourceState.items.length === 0 ? (locale === 'ru' ? 'Нет доступных ресурсов' : 'No resources available') : (locale === 'ru' ? 'Выберите ресурс…' : 'Select a resource…')}</option>{current && !hasCurrent && <option value={current}>{locale === 'ru' ? `Текущее значение: ${current}` : `Current value: ${current}`}</option>}{resourceState.items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{canImportCertificate && <button type="button" className="secondary-button compact schema-resource-open" disabled={disabled || resourceImporting} onClick={() => { setResourceImporting(true); setResourceImportError(false); void resourceContext.importCertificate(resource.id).then((imported) => { if (imported) onChange(path, imported) }).catch(() => { setResourceImportError(true) }).finally(() => { setResourceImporting(false) }) }}><FolderOpen size={14} />{resourceImporting ? (locale === 'ru' ? 'Импорт…' : 'Importing…') : (locale === 'ru' ? 'Импортировать сертификат' : 'Import certificate')}</button>}{canOpen && <button type="button" className="secondary-button compact schema-resource-open" disabled={disabled} onClick={() => { resourceContext.open(current) }}><ExternalLink size={14} />{locale === 'ru' ? 'Открыть файл' : 'Open file'}</button>}{resourceImportError && <small className="schema-unavailable" role="alert">{locale === 'ru' ? 'Не удалось импортировать: выберите корректный публичный сертификат.' : 'Import failed: choose a valid public certificate.'}</small>}{description && <small>{description}</small>}</div>
  }
  if (widget === 'peer') return <ServicePeerPicker title={title} value={value} contractID={peerHint?.peerContractId ?? ''} path={path} onChange={onChange} locale={locale} disabled={disabled} context={peerContext} description={description} />
  if (schema['x-studio-json-document'] === true || allowAnyJSONValue) return <label className="schema-field"><span>{title}</span><textarea className="schema-json-document" spellCheck={false} disabled={disabled} value={jsonDocumentText} maxLength={1_048_576} aria-invalid={Boolean(jsonDocumentError)} onChange={(event) => {
    const source = event.target.value
    setJSONDocumentText(source)
    const parsed = parseConfigurationJSONDocument(source, allowAnyJSONValue)
    if (!parsed.valid) {
      setJSONDocumentError(allowAnyJSONValue
        ? (locale === 'ru' ? 'Введите корректное JSON-значение размером не более 1 МиБ.' : 'Enter a valid JSON value no larger than 1 MiB.')
        : (locale === 'ru' ? 'Введите корректный JSON-объект размером не более 1 МиБ.' : 'Enter a valid JSON object no larger than 1 MiB.'))
      return
    }
    setJSONDocumentError('')
    onChange(path, parsed.value)
  }} />{jsonDocumentError && <small className="schema-number-error" role="alert">{jsonDocumentError}</small>}{description && <small>{description}</small>}</label>
  if (control === 'boolean') return <label className="schema-checkbox"><input type="checkbox" disabled={disabled} checked={value === true} onChange={(event) => { onChange(path, event.target.checked); }} /><span>{title}</span>{description && <small>{description}</small>}</label>
  if (enumValues || control === 'select') return <label className="schema-field"><span>{title}</span><select disabled={disabled} value={JSON.stringify(value ?? schema.default ?? '')} onChange={(event) => { try { onChange(path, JSON.parse(event.target.value) as unknown) } catch { onChange(path, event.target.value) } }}><option value="">{locale === 'ru' ? 'Выберите…' : 'Select…'}</option>{(enumValues ?? []).map((entry, index) => <option key={`${String(index)}:${JSON.stringify(entry)}`} value={JSON.stringify(entry)}>{String(entry)}</option>)}</select>{description && <small>{description}</small>}</label>
  if (control === 'multiselect') return <label className="schema-field"><span>{title}</span><select disabled={disabled} multiple value={Array.isArray(value) ? value.map((entry) => JSON.stringify(entry)) : []} onChange={(event) => { onChange(path, Array.from(event.target.selectedOptions, (option) => JSON.parse(option.value) as unknown)); }}>{(Array.isArray(objectValue(schema.items)?.enum) ? objectValue(schema.items)?.enum as unknown[] : []).map((entry, index) => <option key={`${String(index)}:${JSON.stringify(entry)}`} value={JSON.stringify(entry)}>{String(entry)}</option>)}</select>{description && <small>{description}</small>}</label>
  if (control === 'array') return <fieldset className="schema-array-field"><legend>{title}</legend><SchemaArrayEditor rootSchema={rootSchema ?? schema} schema={schema} value={value} path={path} configurationUI={configurationUI} configurationUIPath={configurationUIPath} onChange={onChange} locale={locale} disabled={disabled} />{description && <small>{description}</small>}</fieldset>
  const inputType = control === 'email' ? 'email' : control === 'url' || control === 'uri' ? 'url' : numeric ? 'number' : control === 'textarea' ? 'text' : 'text'
  const input = <input disabled={disabled} type={inputType} aria-invalid={numeric ? Boolean(numericError) : undefined} value={numeric ? numericText : schemaScalarValue(value)} min={typeof schema.minimum === 'number' ? schema.minimum : undefined} max={typeof schema.maximum === 'number' ? schema.maximum : undefined} step={typeof schema.multipleOf === 'number' ? schema.multipleOf : undefined} minLength={typeof schema.minLength === 'number' ? schema.minLength : undefined} maxLength={typeof schema.maxLength === 'number' ? schema.maxLength : undefined} pattern={typeof schema.pattern === 'string' ? schema.pattern : undefined} onChange={(event) => { if (numeric) changeNumeric(event.target.value); else onChange(path, event.target.value); }} />
  return <label className="schema-field"><span>{title}</span>{control === 'slider' && typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && <input className="schema-slider" aria-label={title} disabled={disabled} type="range" min={schema.minimum} max={schema.maximum} step={typeof schema.multipleOf === 'number' ? schema.multipleOf : undefined} value={typeof value === 'number' ? value : schema.minimum} onChange={(event) => { changeNumeric(event.target.value); }} />}{control === 'textarea' ? <textarea disabled={disabled} value={schemaScalarValue(value)} maxLength={typeof schema.maxLength === 'number' ? schema.maxLength : undefined} onChange={(event) => { onChange(path, event.target.value); }} /> : input}{numericError && <small className="schema-number-error" role="alert">{numericError}</small>}{unit && <small>{unit}</small>}{description && <small>{description}</small>}</label>
}

function ServicePeerPicker({ title, value, contractID, path, onChange, locale, disabled, context, description }: { title: string; value: unknown; contractID: string; path: string[]; onChange: (path: string[], value: unknown) => void; locale: Locale; disabled: boolean; context: ServicePeerContextValue | null; description: string }) {
  const [loadingTarget, setLoadingTarget] = useState('')
  const [verifiedTarget, setVerifiedTarget] = useState('')
  const [error, setError] = useState('')
  const requestID = useRef(0)
  const current = typeof value === 'string' ? value : ''
  const selectedService = context?.services.find((candidate) => candidate.id === current)
  useEffect(() => {
    const request = ++requestID.current
    if (!current || !contractID || !context) {
      setLoadingTarget('')
      setVerifiedTarget('')
      setError('')
      return
    }
    if (verifiedTarget === current) return
    let cancelled = false
    setLoadingTarget(current)
    setError('')
    void context.verify(current, contractID).then(() => {
      if (cancelled || request !== requestID.current) return
      setVerifiedTarget(current)
      setLoadingTarget('')
    }).catch((reason: unknown) => {
      if (cancelled || request !== requestID.current) return
      setVerifiedTarget('')
      setLoadingTarget('')
      setError(reason instanceof Error ? reason.message : 'peer.metadata_unavailable')
    })
    return () => { cancelled = true }
  }, [context, contractID, current, verifiedTarget])

  async function choose(targetID: string) {
    if (!targetID || !context || !contractID) return
    const request = ++requestID.current
    setLoadingTarget(targetID)
    setError('')
    try {
      await context.verify(targetID, contractID)
      if (request !== requestID.current) return
      setVerifiedTarget(targetID)
      setLoadingTarget('')
      onChange(path, targetID)
    } catch (reason: unknown) {
      if (request !== requestID.current) return
      setLoadingTarget('')
      setError(reason instanceof Error ? reason.message : 'peer.metadata_unavailable')
    }
  }

  if (!context || !contractID) return <div className="schema-field"><span>{title}</span><span className="schema-unavailable" role="status">{locale === 'ru' ? 'Контракт связи не задан или Core недоступен.' : 'Peer contract is missing or Core is unavailable.'}</span>{description && <small>{description}</small>}</div>
  const options = context.services.filter((candidate) => candidate.id !== context.serviceID)
  const currentMissing = current && !selectedService
  const status = loadingTarget
    ? (locale === 'ru' ? 'Проверка live-контракта через Core…' : 'Checking the live contract through Core…')
    : error
      ? (error === 'peer.contract_not_advertised' ? (locale === 'ru' ? 'Выбранный сервис не объявляет требуемый контракт.' : 'The selected service does not advertise the required contract.') : locale === 'ru' ? 'Не удалось проверить контракт через Core. Значение не изменено.' : 'Could not verify the contract through Core. The value was not changed.')
      : currentMissing
        ? (locale === 'ru' ? 'Текущий сервис отсутствует в Project; значение сохранено без изменений.' : 'The current service is not in this Project; the value is preserved unchanged.')
        : current && verifiedTarget === current
          ? (locale === 'ru' ? 'Контракт подтверждён live manifest через Core.' : 'Contract verified from the live manifest through Core.')
          : ''
  return <label className="schema-field"><span>{title}</span><select disabled={disabled || Boolean(loadingTarget)} value={current} onChange={(event) => { void choose(event.target.value) }}>
    <option value="">{locale === 'ru' ? 'Выберите сервис…' : 'Select a service…'}</option>
    {currentMissing && <option value={current}>{locale === 'ru' ? `Текущее значение: ${current}` : `Current value: ${current}`}</option>}
    {options.map((candidate) => <option key={candidate.id} value={candidate.id}>{`${candidate.name || candidate.id}${candidate.version ? ` · ${candidate.version}` : ''}`}</option>)}
  </select>{status && <small className={error || currentMissing ? 'schema-number-error' : ''} role="status">{status}</small>}{description && <small>{description}</small>}</label>
}

function configurationWidgetControl(widget: ServiceConfigurationUIField['widget'] | undefined, schema: JsonObject): string {
  switch (widget) {
    case 'text': return 'string'
    case 'textarea': return 'textarea'
    case 'number': return typeof schema.type === 'string' ? schema.type : 'number'
    case 'slider': return 'slider'
    case 'toggle': return 'boolean'
    case 'select': return 'select'
    case 'array': return 'array'
    default: return schemaControl(schema)
  }
}

function configurationValueAtPath(value: JsonObject, segments: string[]): unknown {
  let current: unknown = value
  for (const segment of segments) {
    const object = objectValue(current)
    if (!object || !Object.hasOwn(object, segment)) return undefined
    current = object[segment]
  }
  return current
}

function schemaPathRequired(root: JsonObject, segments: string[]): boolean {
  if (segments.length === 0) return false
  const parent = schemaAtPointer(root, segments.slice(0, -1))
  return Boolean(parent && Array.isArray(parent.required) && parent.required.includes(segments.at(-1)))
}

function sensitiveSchema(schema: JsonObject, propertyName?: string): boolean {
  return schema.readOnly === true || schema.writeOnly === true || schema['x-liapoldus-sensitive'] === true || schema['x-sensitive'] === true || schema['x-secret'] === true || schema['x-redacted'] === true || schema.format === 'password' || isSensitiveConfigurationFieldName(propertyName)
}

function hasVisibleSchemaFields(properties: JsonObject, parentPath: string[], excluded: ReadonlySet<string>): boolean {
  return Object.entries(properties).some(([name, rawSchema]) => {
    const path = [...parentPath, name]
    if (isExcludedInspectorPath(configurationUIFieldKey(path), excluded)) return false
    const schema = objectValue(rawSchema)
    if (!schema) return true
    const type = schemaControl(schema)
    return type !== 'object' || hasVisibleSchemaFields(objectValue(schema.properties) ?? {}, path, excluded) || hasTypedConfigurationMap(schema)
  })
}

function isExcludedInspectorPath(path: string, excluded: ReadonlySet<string>): boolean {
  for (const root of excluded) if (path === root || path.startsWith(`${root}/`)) return true
  return false
}

function schemaScalarValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function formatJSONDocument(value: unknown, allowAnyValue = false): string {
  const object = objectValue(value)
  return JSON.stringify(allowAnyValue ? value ?? null : object ?? {}, null, 2)
}

function SchemaArrayEditor({ rootSchema, schema, value, path, configurationUI, configurationUIPath, onChange, locale, disabled }: { rootSchema: JsonObject; schema: JsonObject; value: unknown; path: string[]; configurationUI: ServiceConfigurationUI | null; configurationUIPath: string[]; onChange: (path: string[], value: unknown) => void; locale: Locale; disabled: boolean }) {
  const values: unknown[] = Array.isArray(value) ? value as unknown[] : []
  const arraySchema = effectiveConfigurationSchema(rootSchema, schema, values) ?? schema
  const itemSchema = configurationSchemaArrayItem(rootSchema, schema)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const minimum = typeof arraySchema.minItems === 'number' ? Math.max(0, Math.ceil(arraySchema.minItems)) : 0
  const maximum = typeof arraySchema.maxItems === 'number' ? Math.max(0, Math.floor(arraySchema.maxItems)) : Number.POSITIVE_INFINITY
  const itemRequired = stringList(itemSchema?.required)
  const protectedItems = Boolean(itemSchema && configurationSchemaProtected(rootSchema, itemSchema))
  const protectedItemTemplate = protectedItems && itemSchema ? createConfigurationSchemaValue(rootSchema, itemSchema) : null
  const canAddProtectedItem = Boolean(protectedItems && itemSchema && configurationSchemaCanCreateProtectedArrayItem(rootSchema, itemSchema, (fieldSchema, current, itemPath) => {
    const hint = matchServiceConfigurationUIField(configurationUI, [...configurationUIPath, String(values.length), ...itemPath])
    const resourceField = fieldSchema.format === 'resource' || fieldSchema['x-liapoldus-resource'] !== undefined || hint?.widget === 'resource'
    if (!resourceField) return configurationSchemaRenderable(rootSchema, fieldSchema, current)
    if (!hint || hint.widget !== 'resource' || !hint.resourceId || !hint.resourceKind) return false
    const resource = configurationUI?.resources.find((entry) => entry.id === hint.resourceId)
    return Boolean(resource && resource.kind === hint.resourceKind && supportsServiceResourceCatalog(resource.provider))
  }))
  const commit = (next: unknown[]) => { onChange(path, next) }
  const commitProtectedOperation = (operation: { op: 'remove'; index: number } | { op: 'move'; from: number; to: number } | { op: 'duplicate'; index: number; to: number }) => {
    onChange(path, configurationArrayOperationRequest(operation))
  }
  if (!itemSchema) return <div className="array-protected" role="status">{locale === 'ru' ? 'Схема элемента списка не поддерживается.' : 'The array item schema is unsupported.'}</div>
  function updateItem(index: number, itemPath: string[], nextValue: unknown) {
    if (protectedItems) {
      onChange([...path, String(index), ...itemPath], nextValue)
      return
    }
    const current = values[index]
    const operations = configurationMapOperations(nextValue)
    const updatedValue = isConfigurationMapOperationRequest(nextValue) && operations?.length === 1
      ? removeConfigurationMapKey(configurationValueAtPath(objectValue(current) ?? {}, itemPath), operations[0]?.key ?? '')
      : nextValue
    const updated = updateArrayItemPath(current, itemPath, updatedValue)
    commit(values.map((entry, currentIndex) => currentIndex === index ? updated : entry))
  }
  function move(index: number, offset: -1 | 1) {
    const target = index + offset
    if (protectedItems) commitProtectedOperation({ op: 'move', from: index, to: target })
    else commit(moveConfigurationArrayItem(values, index, offset))
  }
  const addLabel = locale === 'ru' ? 'Добавить элемент' : 'Add item'
  return <div className="schema-array-editor">
    {protectedItems && <div className="array-protected" role="status">{canAddProtectedItem
      ? (locale === 'ru' ? 'Скрытые и только читаемые значения сохраняются в Project. Новый элемент создаётся из безопасного шаблона; обязательные ссылки можно выбрать в полях ниже.' : 'Hidden and read-only values stay in the project. New items use a safe template; required references can be selected in the fields below.')
      : (locale === 'ru' ? 'Добавление заблокировано: безопасный шаблон не может заполнить обязательное поле, которое недоступно для редактирования в Studio.' : 'Adding is blocked because the safe template cannot initialize a required field that Studio cannot edit.')}</div>}
    {values.length === 0 && <small className="array-empty">{locale === 'ru' ? 'Список пуст' : 'List is empty'}</small>}
    <ol className="schema-array-list" aria-label={locale === 'ru' ? 'Элементы списка' : 'Array items'}>
      {values.map((item, index) => <li
        className={`schema-array-item ${draggedIndex === index ? 'dragging' : ''}`}
        key={`${path.join('/')}:${String(index)}`}
        onDragOver={(event) => { if (!disabled && draggedIndex !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={(event) => {
          if (disabled || draggedIndex === null) return
          event.preventDefault()
          const encodedSource = event.dataTransfer.getData('text/liapoldus-array-index')
          const source = Number(encodedSource)
          if (encodedSource !== '' && Number.isInteger(source) && source === draggedIndex && source >= 0 && source < values.length && source !== index) {
            if (protectedItems) commitProtectedOperation({ op: 'move', from: source, to: index })
            else commit(reorderConfigurationArrayItem(values, source, index))
          }
          setDraggedIndex(null)
        }}
      >
        <div className="schema-array-item-toolbar">
          <span className="array-item-title"><button type="button" className="icon-button small array-drag-handle" aria-label={locale === 'ru' ? 'Перетащить для изменения порядка' : 'Drag to reorder'} title={locale === 'ru' ? 'Перетащить для изменения порядка' : 'Drag to reorder'} draggable={!disabled} disabled={disabled} onDragStart={(event) => { setDraggedIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/liapoldus-array-index', String(index)); }} onDragEnd={() => { setDraggedIndex(null); }}><GripVertical size={14} aria-hidden="true" /></button><strong>{locale === 'ru' ? `Элемент ${String(index + 1)}` : `Item ${String(index + 1)}`}</strong></span>
          <div className="array-item-actions">
            <><button type="button" className="icon-button small" aria-label={locale === 'ru' ? 'Переместить вверх' : 'Move up'} title={locale === 'ru' ? 'Переместить вверх' : 'Move up'} disabled={disabled || index === 0} onClick={() => { move(index, -1); }}><ChevronUp size={14} /></button>
            <button type="button" className="icon-button small" aria-label={locale === 'ru' ? 'Переместить вниз' : 'Move down'} title={locale === 'ru' ? 'Переместить вниз' : 'Move down'} disabled={disabled || index === values.length - 1} onClick={() => { move(index, 1); }}><ChevronDown size={14} /></button>
            <button type="button" className="icon-button small" aria-label={locale === 'ru' ? 'Дублировать элемент' : 'Duplicate item'} title={locale === 'ru' ? 'Дублировать' : 'Duplicate'} disabled={disabled || values.length >= maximum || arraySchema.uniqueItems === true} onClick={() => { if (protectedItems) commitProtectedOperation({ op: 'duplicate', index, to: index + 1 }); else commit(duplicateConfigurationArrayItem(values, index)); }}><CopyIcon size={13} /></button>
            <button type="button" className="icon-button small danger" aria-label={locale === 'ru' ? 'Удалить элемент' : 'Remove item'} title={locale === 'ru' ? 'Удалить' : 'Remove'} disabled={disabled || values.length <= minimum} onClick={() => { if (protectedItems) commitProtectedOperation({ op: 'remove', index }); else commit(removeConfigurationArrayItem(values, index, minimum)); }}><Trash2 size={13} /></button></>
          </div>
        </div>
        <div className="schema-array-item-content">
          {configurationSchemaVariants(rootSchema, itemSchema)
            ? <SchemaVariantField rootSchema={rootSchema} schema={itemSchema} variants={configurationSchemaVariants(rootSchema, itemSchema) ?? []} name={locale === 'ru' ? `Вариант элемента ${String(index + 1)}` : `Item ${String(index + 1)} variant`} value={item} path={protectedItems ? [...path, String(index)] : []} configurationUI={configurationUI} configurationUIPath={[...configurationUIPath, String(index)]} onChange={(itemPath, nextValue) => { if (protectedItems) onChange(itemPath, nextValue); else updateItem(index, itemPath, nextValue); }} locale={locale} disabled={disabled} />
            : schemaControl(effectiveConfigurationSchema(rootSchema, itemSchema, item) ?? itemSchema) === 'object'
              ? <SchemaProperties rootSchema={rootSchema} objectSchema={effectiveConfigurationSchema(rootSchema, itemSchema, item) ?? itemSchema} properties={objectValue(effectiveConfigurationSchema(rootSchema, itemSchema, item)?.properties) ?? objectValue(itemSchema.properties) ?? {}} values={objectValue(item) ?? {}} path={protectedItems ? [...path, String(index)] : []} configurationUIPath={[...configurationUIPath, String(index)]} configurationUI={configurationUI} required={itemRequired} onChange={(itemPath, nextValue) => { if (protectedItems) onChange(itemPath, nextValue); else updateItem(index, itemPath, nextValue); }} locale={locale} disabled={disabled} />
              : <SchemaField name={locale === 'ru' ? `Значение ${String(index + 1)}` : `Value ${String(index + 1)}`} schema={effectiveConfigurationSchema(rootSchema, itemSchema, item) ?? itemSchema} value={item} required path={protectedItems ? [...path, String(index)] : []} configurationUI={configurationUI} configurationUIPath={[...configurationUIPath, String(index)]} onChange={(itemPath, nextValue) => { if (protectedItems) onChange(itemPath, nextValue); else updateItem(index, [], nextValue); }} locale={locale} disabled={disabled} description="" rootSchema={rootSchema} />}
        </div>
      </li>)}
    </ol>
    <button type="button" className="secondary-button compact array-add" disabled={disabled || values.length >= maximum || (protectedItems && !canAddProtectedItem)} onClick={() => {
      if (protectedItems) {
        onChange(path, configurationArrayOperationRequest({ op: 'insert', index: values.length, value: protectedItemTemplate }))
        return
      }
      commit([...values, createConfigurationArrayItem(itemSchema)])
    }}><Plus size={14} />{addLabel}</button>
  </div>
}

function updateArrayItemPath(value: unknown, path: string[], nextValue: unknown): unknown {
  if (path.length === 0) return nextValue
  const [segment, ...rest] = path
  if (!segment || ['__proto__', 'prototype', 'constructor'].includes(segment)) return value
  const object = objectValue(value) ?? {}
  return { ...object, [segment]: updateArrayItemPath(object[segment], rest, nextValue) }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry: unknown): entry is string => typeof entry === 'string') : []
}

function displayValue(value: unknown): string { return value === undefined || value === null ? '—' : typeof value === 'string' ? value : JSON.stringify(value) }

function LinkContractInspector({ controller, link, locale }: { controller: StudioController; link: ServiceLink; locale: Locale }) {
  const [draft, setDraft] = useState<ServiceLinkInput>(() => linkInput(link))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(linkInput(link)); setError('') }, [link])
  function textField(name: keyof ServiceLinkInput, label: string) { return <label className="schema-field" key={name}><span>{label}</span><input value={String(draft[name])} onChange={(event) => { setDraft((current) => ({ ...current, [name]: event.target.value })); }} /></label> }
  function numberField(name: 'timeoutMillis' | 'retryLimit' | 'requestLimitBytes' | 'responseLimitBytes', label: string) { return <label className="schema-field" key={name}><span>{label}</span><input type="number" min={name === 'retryLimit' ? 0 : 1} value={draft[name]} onChange={(event) => { setDraft((current) => ({ ...current, [name]: Number(event.target.value) })); }} /></label> }
  async function save() { setSaving(true); setError(''); try { await controller.updateServiceLink(draft) } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : 'Could not update link contract') } finally { setSaving(false) } }
  return <InspectorSection title={locale === 'ru' ? 'Полный контракт' : 'Full contract'}><div className="schema-form">
    <InspectorField label="Caller" value={draft.caller} /><InspectorField label="Link ID" value={draft.id} />
    {textField('target', 'Target')}{textField('contractVersion', 'Contract version')}{textField('transport', 'Transport')}{textField('securityProfile', 'Security profile')}
    <label className="schema-field"><span>Methods</span><textarea value={draft.methods.join('\n')} onChange={(event) => { setDraft((current) => ({ ...current, methods: event.target.value.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean) })); }} /></label>
    {textField('requestSchemaPath', 'Request schema')}{textField('responseSchemaPath', 'Response schema')}{textField('contractSchemaPath', 'Contract schema')}
    {numberField('timeoutMillis', 'Timeout (ms)')}{numberField('retryLimit', 'Retry limit')}{numberField('requestLimitBytes', 'Request limit (bytes)')}{numberField('responseLimitBytes', 'Response limit (bytes)')}
    <label className="schema-field"><span>Disabled methods</span><textarea value={draft.disabledMethods.join('\n')} onChange={(event) => { setDraft((current) => ({ ...current, disabledMethods: event.target.value.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean) })); }} /></label>
    {textField('compatibility', 'Compatibility')}{textField('redactionPolicy', 'Redaction policy')}
    {error && <p className="inline-error" role="alert">{error}</p>}<button type="button" className="primary-button compact" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save contract'}</button>
  </div></InspectorSection>
}

function linkInput(link: ServiceLink): ServiceLinkInput { return { id: link.id, caller: link.caller, target: link.target, contractVersion: link.contractVersion, methods: [...link.methods], transport: link.transport, requestSchemaPath: link.requestSchemaPath, responseSchemaPath: link.responseSchemaPath, contractSchemaPath: link.contractSchemaPath, securityProfile: link.securityProfile, timeoutMillis: link.timeoutMillis, retryLimit: link.retryLimit, requestLimitBytes: link.requestLimitBytes, responseLimitBytes: link.responseLimitBytes, disabledMethods: [...link.disabledMethods], compatibility: link.compatibility, redactionPolicy: link.redactionPolicy } }


export function ProblemsView({ diagnostics, t }: { diagnostics: Diagnostic[]; t: Copy }) {
  const groups = groupDiagnostics(diagnostics)
  return <section className="settings-view problems-view"><div className="settings-header"><span className="eyebrow">{t.problems}</span><h1>{groups.length}</h1>{groups.length !== diagnostics.length && <p>{String(diagnostics.length)} events · {String(groups.length)} unique</p>}</div>{groups.length === 0 ? <div className="report-empty"><Check size={18} /><span>{t.clean}</span></div> : <div className="problem-list">{groups.map(({ diagnostic: item, count }) => <article className="problem-row" key={`${item.owner}:${item.code}:${item.operationId ?? ''}:${item.target ?? ''}:${item.message}`}><AlertTriangle size={16} /><div><strong>{item.code}{count > 1 ? ` · ×${String(count)}` : ''}</strong><p>{item.message}</p><small>{item.owner} · {item.timestamp}</small></div></article>)}</div>}</section>
}

export function OutputView({ cliEvents, runtimeOutput, streamState, controller, t }: { cliEvents: CLIEvent[]; runtimeOutput: string; streamState: CLIStreamState; controller: StudioController; t: Copy }) {
  const locale = useStudioStore((state) => state.locale)
  const replicaOutcomes = operationReplicaOutcomes(cliEvents)
  const streamLabel = streamState === 'running' ? t.cliRunning : streamState === 'cancelling' ? t.cliCancelling : ''
  return <section className="settings-view output-view"><div className="settings-header"><span className="eyebrow">{t.cli}</span><h1>Output</h1><p>{cliEvents.length} {t.cliEvents}</p>{streamState !== 'idle' && <div className="output-toolbar"><span aria-live="polite">{streamLabel}</span><button type="button" className="secondary-button compact" disabled={streamState === 'cancelling'} onClick={() => { void controller.cancelCLI() }}>{streamState === 'cancelling' ? t.cliCancelling : t.cliCancel}</button></div>}{streamState === 'cancelling' && <p className="output-cancel-note">{t.cliCancelNote}</p>}</div>{runtimeOutput && <pre className="runtime-output">{runtimeOutput}</pre>}{replicaOutcomes.length > 0 && <section className="operation-replicas" aria-label={locale === 'ru' ? 'Результат применения по репликам' : 'Per-replica apply result'}><h2>{locale === 'ru' ? 'Применение конфигурации' : 'Configuration rollout'}</h2><div>{replicaOutcomes.map((outcome) => <article key={outcome.replicaId}><code>{outcome.replicaId}</code><span>{locale === 'ru' ? `Поколение ${String(outcome.desiredGeneration)}` : `Generation ${String(outcome.desiredGeneration)}`}</span><strong data-state={outcome.state}>{locale === 'ru' ? ({ pending: 'Ожидает', applied: 'Применено', failed: 'Ошибка' } as const)[outcome.state] : outcome.state}</strong>{outcome.failureCode && <small>{outcome.failureCode}</small>}</article>)}</div></section>}<div className="output-events">{cliEvents.length === 0 ? <div className="report-empty"><Terminal size={18} /><span>{t.noOutput}</span></div> : cliEvents.map((event, index) => <article className="output-event" key={`${event.timestamp ?? ''}:${String(index)}`}><time>{event.timestamp || '—'}</time><strong>{event.type}</strong><span>{summarizeCLIEvent(event)}</span></article>)}</div></section>
}

export function StudioPluginSurfaceFrame({ tab, controller, surface, project, service }: {
  tab: WorkspaceTab
  controller: StudioController
  surface: StudioPluginSurface | undefined
  project: { id: string; name: string } | null
  service: { id: string; name: string; version: string } | null
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const locale = useStudioStore((state) => state.locale)
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [failureCode, setFailureCode] = useState('surface.handshake_timeout')
  const [retryCount, setRetryCount] = useState(0)
  const sessionID = useMemo(() => createStudioBridgeSessionID(), [tab.id])
  const src = studioPluginSurfaceAssetURL(tab)
  useEffect(() => {
    setFrameState('loading')
    setFailureCode('surface.handshake_timeout')
    const target = frame.current?.contentWindow
    let stopHandshake = () => {}
    const timeout = window.setTimeout(() => { stopHandshake(); setFailureCode('surface.handshake_timeout'); setFrameState('failed') }, 8000)
    let connected = false
    let pending = 0
    const requestTimes: number[] = []
    const declaredPermissions = new Set(surface?.permissions ?? [])
    const grantedPermissions = new Set(surface?.grantedPermissions ?? [])
    const hasPermission = (permission: string) => studioPluginPermissionGranted(declaredPermissions, grantedPermissions, permission)
    const context = {
      project: project ? { id: project.id, name: project.name } : null,
      service: service ? { id: service.id, name: service.name, version: service.version } : null,
      locale,
      theme: useStudioStore.getState().theme,
    }
    function sendHostReady() {
      if (!target) return
      target.postMessage({ type: 'studio.host.ready', schemaVersion: studioServiceEditorBridgeVersion, sessionId: sessionID, context }, '*')
    }
    function reply(requestId: string, result?: unknown, errorCode?: string) {
      if (!target) return
      const response = { type: 'studio.bridge.response', schemaVersion: studioServiceEditorBridgeVersion, sessionId: sessionID, requestId, ok: !errorCode, ...(errorCode ? { error: { code: errorCode } } : { result }) }
      try {
        if (JSON.stringify(response).length > 262_144) {
          target.postMessage({ type: 'studio.bridge.response', schemaVersion: studioServiceEditorBridgeVersion, sessionId: sessionID, requestId, ok: false, error: { code: 'bridge.response_too_large' } }, '*')
          return
        }
        target.postMessage(response, '*')
      } catch {
        target.postMessage({ type: 'studio.bridge.response', schemaVersion: studioServiceEditorBridgeVersion, sessionId: sessionID, requestId, ok: false, error: { code: 'bridge.response_invalid' } }, '*')
      }
    }
    async function dispatch(request: NonNullable<ReturnType<typeof parseStudioPluginBridgeRequest>>) {
      if (request.method === 'context.get') {
        reply(request.requestId, { ...context, capabilities: { settingsRead: hasPermission('service.settings.read'), settingsWrite: hasPermission('service.settings.write'), configurationUIRead: hasPermission('service.configuration-ui.read'), resourceRead: hasPermission('service.resources.read'), adminSurfaceRead: hasPermission('service.resources.read'), resourcePublish: hasPermission('service.resources.publish'), peerCatalogRead: hasPermission('service.peer.catalog.read'), secretReferencesRead: hasPermission('service.secrets.read'), apply: false } })
        return
      }
      if (!project || !service) { reply(request.requestId, undefined, 'bridge.service_not_selected'); return }
      if (request.method === 'service.settings.read') {
        if (!hasPermission('service.settings.read')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        try { reply(request.requestId, await controller.pluginReadServiceSettings(project.id, service.id)) }
        catch { reply(request.requestId, undefined, 'bridge.settings_unavailable') }
        return
      }
      if (request.method === 'service.configuration-ui.read') {
        if (!hasPermission('service.configuration-ui.read')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        try { reply(request.requestId, await controller.pluginReadServiceConfigurationUI(project.id, service.id)) }
        catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.configuration_ui_unavailable'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.resource.list') {
        if (!hasPermission('service.resources.read')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        if (!payload || typeof payload.resourceId !== 'string') { reply(request.requestId, undefined, 'bridge.invalid_resource'); return }
        try { reply(request.requestId, await controller.pluginReadServiceResource(project.id, service.id, payload.resourceId)) }
        catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.resource_unavailable'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.admin-surface.read') {
        if (!hasPermission('service.resources.read')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        try { reply(request.requestId, await controller.pluginReadServiceAdminSurface(project.id, service.id)) }
        catch (error: unknown) {
          const code = studioPluginBridgeFailureCode(error, 'bridge.admin_surface_unavailable')
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.resource.artifact.select') {
        if (!hasPermission('service.resources.publish')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const selection = objectValue(request.payload)
        if (selection && (Object.keys(selection).length !== 1 || selection.source !== 'project-directory')) { reply(request.requestId, undefined, 'bridge.invalid_resource_selection'); return }
        try {
          const path = await controller.pluginSelectServiceResourceArtifact(project.id, service.id, selection?.source === 'project-directory' ? 'project-directory' : 'archive')
          reply(request.requestId, path)
        } catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.resource_artifact_unavailable'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.resource.publish') {
        if (!hasPermission('service.resources.publish')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        if (!payload || typeof payload.pageId !== 'string' || typeof payload.actionId !== 'string' ||
            typeof payload.artifactPath !== 'string' || typeof payload.contentType !== 'string' || !objectValue(payload.metadata) ||
            (payload.ifMatch !== undefined && typeof payload.ifMatch !== 'string')) {
          reply(request.requestId, undefined, 'bridge.invalid_resource_publish')
          return
        }
        try {
          const result = await controller.pluginPublishServiceResource(project.id, service.id, {
            pageId: payload.pageId, actionId: payload.actionId, artifactPath: payload.artifactPath,
            contentType: payload.contentType, metadata: objectValue(payload.metadata) ?? {},
            ...(typeof payload.ifMatch === 'string' ? { ifMatch: payload.ifMatch } : {}),
          })
          reply(request.requestId, result)
        } catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.resource_publish_failed'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.resource.operation.watch') {
        if (!hasPermission('service.resources.publish')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        if (!payload || typeof payload.operationId !== 'string') { reply(request.requestId, undefined, 'bridge.invalid_operation'); return }
        try { reply(request.requestId, await controller.pluginWatchServiceResourceOperation(project.id, service.id, payload.operationId)) }
        catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.operation_watch_failed'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.peer.catalog.read') {
        if (!hasPermission('service.peer.catalog.read')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        const targetServiceID = payload?.targetServiceId
        if (targetServiceID !== undefined && typeof targetServiceID !== 'string') { reply(request.requestId, undefined, 'bridge.invalid_peer_target'); return }
        try { reply(request.requestId, await withPeerCatalogDeadline(controller.pluginReadServicePeerCatalog(project.id, service.id, targetServiceID))) }
        catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.peer_catalog_unavailable'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.secret.references.read') {
        if (!hasPermission('service.secrets.read')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        if (!payload || typeof payload.purpose !== 'string') { reply(request.requestId, undefined, 'bridge.invalid_secret_purpose'); return }
        try { reply(request.requestId, await controller.pluginReadServiceSecretReferences(project.id, service.id, payload.purpose)) }
        catch (error: unknown) {
          const code = studioPluginBridgeFailureCode(error, 'bridge.secret_catalog_unavailable')
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.settings.recovery.copy') {
        if (!hasPermission('service.settings.write')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        if (!payload || typeof payload.baseDigest !== 'string') { reply(request.requestId, undefined, 'bridge.recovery_request_invalid'); return }
        try { reply(request.requestId, await controller.pluginCreateServiceSettingsRecoveryCopy(project.id, service.id, payload.baseDigest)) }
        catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.recovery_copy_failed'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.settings.secret-reference.select') {
        if (!hasPermission('service.secrets.read') || !hasPermission('service.settings.write')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        if (!payload || !Array.isArray(payload.path) || typeof payload.purpose !== 'string' || typeof payload.reference !== 'string') {
          reply(request.requestId, undefined, 'bridge.secret_selection_invalid')
          return
        }
        try {
          const result = await controller.pluginSelectServiceSecretReference(project.id, service.id, payload.path as string[], payload.purpose, payload.reference)
          reply(request.requestId, { status: result.status, baseDigest: result.baseDigest, errorCode: result.errorCode })
        } catch (error: unknown) {
          const code = studioPluginBridgeFailureCode(error, 'bridge.secret_selection_failed')
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (request.method === 'service.settings.patch') {
        if (!hasPermission('service.settings.write')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
        const payload = objectValue(request.payload)
        const path = payload?.path
        if (!payload || !Array.isArray(path) || path.length === 0 || path.length > 64 || path.some((segment) => typeof segment !== 'string' || segment.length === 0 || segment.length > 256)) {
          reply(request.requestId, undefined, 'bridge.patch_payload_invalid')
          return
        }
        try {
          const result = await controller.pluginPatchServiceSettings(project.id, service.id, path as string[], payload.value)
          reply(request.requestId, { status: result.status, baseDigest: result.baseDigest, errorCode: result.errorCode })
        } catch (error: unknown) {
          const code = error instanceof Error && error.message.startsWith('bridge.') ? error.message : 'bridge.invalid_patch'
          reply(request.requestId, undefined, code)
        }
        return
      }
      if (!hasPermission('service.settings.write')) { reply(request.requestId, undefined, 'bridge.permission_denied'); return }
      try {
        const payload = objectValue(request.payload)
        if (payload && (Object.keys(payload).length !== 1 || payload.allowIncomplete !== true)) { reply(request.requestId, undefined, 'bridge.invalid_save_options'); return }
        const result = await controller.pluginSaveServiceSettings(project.id, service.id, payload?.allowIncomplete === true)
        reply(request.requestId, { status: result.status, baseDigest: result.baseDigest, errorCode: result.errorCode })
      } catch {
        reply(request.requestId, undefined, 'bridge.save_failed')
      }
    }
    function onMessage(event: MessageEvent<unknown>) {
      if (!target || event.source !== target || event.origin !== 'null') return
      if (isStudioPluginSurfaceReadyMessage(event.data, sessionID)) {
        connected = true
        stopHandshake()
        window.clearTimeout(timeout)
        setFrameState('ready')
        return
      }
      const request = parseStudioPluginBridgeRequest(event.data)
      if (!connected || !request || request.sessionId !== sessionID) return
      const now = Date.now()
      while (requestTimes.length > 0 && now - (requestTimes[0] ?? now) > 60_000) requestTimes.shift()
      if (requestTimes.length >= 60) { reply(request.requestId, undefined, 'bridge.rate_limited'); return }
      if (pending >= 4) { reply(request.requestId, undefined, 'bridge.busy'); return }
      requestTimes.push(now)
      pending++
      void dispatch(request).finally(() => { pending-- })
    }
    window.addEventListener('message', onMessage)
    // The iframe can finish its load before the plugin's module listeners are
    // ready. Repeat the same session-bound hello until the plugin acknowledges.
    stopHandshake = startStudioPluginHandshake(sendHostReady, (callback, delay) => { return window.setInterval(callback, delay) }, (handle) => { window.clearInterval(handle as number) })
    return () => { stopHandshake(); window.clearTimeout(timeout); window.removeEventListener('message', onMessage) }
  }, [controller, locale, project?.id, project?.name, retryCount, service?.id, service?.name, service?.version, sessionID, surface, tab.id])
  function notifyReady() {
    const target = frame.current?.contentWindow
    if (!target) return
    target.postMessage({
      type: 'studio.host.ready',
      schemaVersion: studioServiceEditorBridgeVersion,
      sessionId: sessionID,
      context: { project: project ? { id: project.id, name: project.name } : null, service: service ? { id: service.id, name: service.name, version: service.version } : null, locale, theme: useStudioStore.getState().theme },
    }, '*')
  }
  const copy = locale === 'ru'
  return <section className="plugin-surface-workspace"><div className="plugin-surface-toolbar"><span>{tab.title}</span><span className="muted" role="status">{frameState === 'loading' ? (copy ? 'Загрузка редактора…' : 'Loading editor…') : frameState === 'ready' ? (copy ? 'Подключено' : 'Connected') : (copy ? 'Поверхность недоступна' : 'Surface unavailable')}</span></div>{surface?.context === 'service' && !service ? <div className="plugin-surface-empty" role="alert"><AlertTriangle size={22} /><h2>{copy ? 'Контекст сервиса недоступен' : 'Service context unavailable'}</h2><p>{copy ? 'Откройте редактор кнопкой выбранного сервиса в Inspector.' : 'Open this editor from the selected service in the Inspector.'}</p></div> : !src ? <div className="plugin-surface-empty" role="alert"><AlertTriangle size={22} /><p>surface.invalid_route</p></div> : <><iframe key={retryCount} ref={frame} title={tab.title} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={notifyReady} onError={() => { setFailureCode('surface.asset_load_failed'); setFrameState('failed') }} />{frameState === 'failed' && <div className="plugin-surface-error" role="alert"><AlertTriangle size={20} /><h2>{copy ? 'Не удалось открыть поверхность' : 'Surface unavailable'}</h2><p>{copy ? 'Плагин не завершил безопасное подключение к Studio.' : 'The plugin did not complete its secure Studio handshake.'}</p><code>{failureCode}</code><button type="button" className="secondary-button compact" onClick={() => { setFrameState('loading'); setRetryCount((count) => count + 1) }}>{copy ? 'Повторить' : 'Retry'}</button></div>}</>}</section>
}

export function ReportsView({ controller, t }: { controller: StudioController; t: Copy }) {
  const traffic = useStudioStore((state) => state.traffic)
  const [exportedPath, setExportedPath] = useState('')
  useEffect(() => { void controller.loadTraffic() }, [controller])
  async function exportReport() {
    const path = await controller.exportTrafficReport()
    if (path) setExportedPath(path)
  }
  return <section className="settings-view reports-view">
    <div className="settings-header"><span className="eyebrow">{t.reports}</span><h1>{t.reportTitle}</h1><p>{t.reportHint}</p></div>
    <div className="report-toolbar"><span className="runtime-chip">{traffic.length}</span><div className="toolbar-actions"><button className="secondary-button compact" onClick={() => void controller.loadTraffic()}><RefreshCw size={14} />{t.reportRefresh}</button><button className="primary-button compact" disabled={traffic.length === 0} onClick={() => void exportReport()}><Download size={14} />{t.reportExport}</button></div></div>
    {exportedPath && <p className="report-exported" role="status">{t.reportExported}: <code>{exportedPath}</code></p>}
    {traffic.length === 0 ? <div className="report-empty"><Activity size={20} /><span>{t.reportEmpty}</span></div> : <div className="report-table-wrap"><table className="report-table"><thead><tr><th>{t.reportTimestamp}</th><th>{t.reportRoute}</th><th>{t.reportMethod}</th><th>{t.reportStatus}</th><th>{t.reportLatency}</th><th>{t.reportPayloads}</th></tr></thead><tbody>{traffic.map((record, index) => <tr key={`${record.reportOperationId}:${record.correlationId}:${String(index)}`}><td><time>{record.timestamp}</time><small>{record.correlationId}</small></td><td><strong>{record.caller}</strong><span className="report-arrow">→</span><strong>{record.target}</strong></td><td><code>{record.method}</code><small>{record.transport}</small></td><td><span className="report-status">{record.status}</span><small>{record.schemaValidation}</small></td><td>{record.latencyMillis} ms<small>{record.requestSize} B → {record.responseSize} B</small></td><td><details><summary>{t.reportPayloads}</summary><div className="report-payloads"><strong>Request</strong><pre>{record.requestPayload}</pre><strong>Response</strong><pre>{record.responsePayload}</pre></div></details></td></tr>)}</tbody></table></div>}
  </section>
}

export function ArtifactsView({ controller, t }: { controller: StudioController; t: Copy }) {
  const [artifacts, setArtifacts] = useState<ArtifactReference[]>([])
  const workspace = useStudioStore((state) => state.workspace)
  const [id, setID] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [platform, setPlatform] = useState('linux/arm64')
  const [binaryPath, setBinaryPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [serviceID, setServiceID] = useState(workspace?.graph.services[0]?.id ?? '')
  const [artifactKey, setArtifactKey] = useState('')
  const [bound, setBound] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ArtifactReference | null>(null)
  async function reload() { setArtifacts(await controller.listArtifacts()) }
  useEffect(() => { void reload() }, [])
  useEffect(() => {
    if (!workspace?.graph.services.some((service) => service.id === serviceID)) setServiceID(workspace?.graph.services[0]?.id ?? '')
  }, [serviceID, workspace?.graph.services])
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
  async function remove() {
    if (!removeTarget) return
    setBusy(true)
    try {
      if (await controller.removeArtifact(removeTarget)) {
        setRemoveTarget(null)
        await reload()
      }
    } finally { setBusy(false) }
  }
  const selectedService = workspace?.graph.services.find((service) => service.id === serviceID)
  const bindableArtifacts = artifacts.filter((artifact) => artifact.id === serviceID && artifact.trusted)
  const selectedArtifact = bindableArtifacts.find((artifact) => `${artifact.version}:${artifact.platform}` === artifactKey)
  const artifactGroups = groupRuntimeArtifacts(artifacts, workspace?.graph.services ?? [])
  async function bindArtifact() {
    if (!selectedService || !selectedArtifact) return
    setBusy(true)
    setBound(false)
    try { setBound(await controller.bindRuntimeServiceArtifact(selectedService.id, selectedArtifact.version, selectedArtifact.platform)) }
    finally { setBusy(false) }
  }
  return <section className="settings-view artifacts-view">
    <div className="settings-header"><span className="eyebrow">{t.artifacts}</span><h1>Operator-owned binaries</h1><p>Studio registers existing binaries. It never builds services or stores their paths in the Project.</p></div>
    <div className="settings-grid">
      <div className="settings-section">
        <h3>Register binary</h3>
        <div className="setup-row">
          <input value={id} onChange={(event) => { setID(event.target.value) }} placeholder="service id" aria-label="Service id" />
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
        {artifacts.length === 0 ? <span className="muted">No binaries registered.</span> : <div className="change-list artifact-groups">{artifactGroups.map(({ service, entries, bound }) => <details className="artifact-group" key={service}>
          <summary><PackageCheck size={14} /><strong>{service}</strong><span className="artifact-version-count">{entries.length} {entries.length === 1 ? 'version' : 'versions'}</span>{bound && <span className="artifact-bound-summary">Project · {bound.version}</span>}</summary>
          <div className="artifact-group-entries">{entries.map((artifact) => {
            const isBound = bound?.version === artifact.version && bound.platform === artifact.platform
            return <div className="change-row" key={`${artifact.id}:${artifact.version}:${artifact.platform}`}><span className={`status-dot ${artifact.trusted ? 'status-success' : 'status-warning'}`} /><span><strong>{artifact.version}{isBound && <span className="artifact-bound-label"> · Project</span>}</strong><small>{artifact.platform} · {artifact.digest.slice(0, 20)}…</small></span>{!artifact.trusted && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void trust(artifact)}>Trust</button>}<button type="button" className="secondary-button compact" disabled={busy} title="Remove artifact registry entry" aria-label={`Remove ${artifact.id} ${artifact.version} ${artifact.platform}`} onClick={() => { setRemoveTarget(artifact); }}><Trash2 size={14} /></button></div>
          })}</div>
        </details>)}</div>}
      </div>
      <div className="settings-section artifact-binding">
        <h3>Project service binding</h3>
        {!workspace?.graph.services.length ? <span className="muted">Open a Project with services to bind registered binaries.</span> : <>
          <div className="setup-row">
            <select aria-label="Project service" value={serviceID} onChange={(event) => { setServiceID(event.target.value); setArtifactKey(''); setBound(false) }}>
              {workspace.graph.services.map((service) => <option key={service.id} value={service.id}>{service.id}</option>)}
            </select>
            <select aria-label="Trusted service artifact" value={artifactKey} onChange={(event) => { setArtifactKey(event.target.value); setBound(false) }}>
              <option value="">Select a trusted artifact</option>
              {bindableArtifacts.map((artifact) => <option key={`${artifact.version}:${artifact.platform}`} value={`${artifact.version}:${artifact.platform}`}>{artifact.version} · {artifact.platform}</option>)}
            </select>
            <button className="primary-button compact" disabled={busy || !selectedArtifact} onClick={() => void bindArtifact()}><PackageCheck size={14} />Bind to Project</button>
          </div>
          {selectedService?.artifact && <p className="muted">Current: {selectedService.artifact.version} · {selectedService.artifact.platform} · {selectedService.artifact.digest.slice(0, 20)}…</p>}
          {selectedService && !bindableArtifacts.length && <p className="muted">No trusted binary registered for “{selectedService.id}”. Register and trust it first.</p>}
          {bound && <p className="report-exported" role="status">Artifact reference saved to {selectedService?.servicePath}; no binary path or trust data was written to the Project.</p>}
        </>}
      </div>
    </div>
    {removeTarget && <div className="modal-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="artifact-remove-heading">
      <div className="dialog-heading"><div><span className="eyebrow">Registered binaries</span><h2 id="artifact-remove-heading">Remove artifact?</h2></div><button type="button" className="icon-button" aria-label="Cancel" onClick={() => { if (!busy) { setRemoveTarget(null); } }} disabled={busy}><X size={16} /></button></div>
      <p className="dialog-hint"><strong>{removeTarget.id} · {removeTarget.version} · {removeTarget.platform}</strong></p>
      <p className="dialog-hint">This removes only its local CLI registry entry. A Project referencing it will not run until a matching artifact is registered again. Project files and the external binary are not changed.</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setRemoveTarget(null); }} disabled={busy}>Cancel</button><button type="button" className="primary-button" onClick={() => void remove()} disabled={busy}><Trash2 size={14} />Remove</button></div>
    </section></div>}
  </section>
}

export function SettingsView({ controller, locale, theme, toolchain, t, pluginManager, artifactsManager }: { controller: StudioController; locale: Locale; theme: ThemePreference; toolchain: ToolchainStatus | null; t: Copy; pluginManager: ReactNode; artifactsManager: ReactNode }) {
  const [category, setCategory] = useState<'editor' | 'appearance' | 'language' | 'toolchain' | 'core' | 'plugins' | 'services' | 'docker' | 'secrets'>('plugins')
  const workspace = useStudioStore((state) => state.workspace)
  const target = useStudioStore((state) => state.target)
  const profile = useStudioStore((state) => state.profile)
  const setField = useStudioStore((state) => state.setField)
  const setToolchain = useStudioStore((state) => state.setToolchain)
  const [editorAssociations, setEditorAssociations] = useState<Array<{ pattern: string; application: string }>>([])
  const [editorPattern, setEditorPattern] = useState('*.yaml')
  const [editorApplication, setEditorApplication] = useState('')
  const [editorError, setEditorError] = useState('')
  const [cliPath, setCLIPath] = useState(toolchain?.cliPath ?? '')
  const [cliError, setCLIError] = useState('')
  const [cliBusy, setCLIBusy] = useState(false)
  const [coreBinaryPath, setCoreBinaryPath] = useState('')
  const [coreBinaryInspection, setCoreBinaryInspection] = useState<{ digest: string; platform: string; sizeBytes: number } | null>(null)
  const [confirmCoreBinaryUpdate, setConfirmCoreBinaryUpdate] = useState(false)
  const [coreBinaryError, setCoreBinaryError] = useState('')
  const [coreBinaryBusy, setCoreBinaryBusy] = useState(false)
  const [coreSettings, setCoreSettings] = useState<CoreSettingsView | null>(null)
  const [coreSettingsDraft, setCoreSettingsDraft] = useState({ maxBodyBytes: '', headerTimeout: '', requestTimeout: '' })
  const [coreSettingsBusy, setCoreSettingsBusy] = useState(false)
  const [coreSettingsError, setCoreSettingsError] = useState('')
  const [confirmCoreSettingsApply, setConfirmCoreSettingsApply] = useState(false)
  async function reloadEditorAssociations() {
    try { setEditorAssociations(await controller.api.editorAssociations()); setEditorError('') }
    catch (reason: unknown) { setEditorError(reason instanceof Error ? reason.message : 'Could not load editor preferences') }
  }
  useEffect(() => { void reloadEditorAssociations() }, [controller])
  async function chooseEditor() {
    try { const path = await controller.api.selectExternalEditor(); if (path) setEditorApplication(path) }
    catch (reason: unknown) { setEditorError(reason instanceof Error ? reason.message : 'Could not select editor') }
  }
  async function saveEditor(pattern: string) {
    if (!editorApplication.trim()) return
    try { await controller.api.saveEditorAssociation(pattern, editorApplication.trim()); setEditorApplication(''); await reloadEditorAssociations() }
    catch (reason: unknown) { setEditorError(reason instanceof Error ? reason.message : 'Could not save editor association') }
  }
  async function removeEditor(pattern: string) {
    try { await controller.api.removeEditorAssociation(pattern); await reloadEditorAssociations() }
    catch (reason: unknown) { setEditorError(reason instanceof Error ? reason.message : 'Could not remove editor association') }
  }
  async function chooseCLI() {
    try { const path = await controller.api.selectCLIExecutable(); if (path) { setCLIPath(path); setCLIError('') } }
    catch (reason: unknown) { setCLIError(reason instanceof Error ? reason.message : 'Could not select CLI') }
  }
  async function configureCLI() {
    if (!cliPath.trim()) return
    setCLIBusy(true)
    try { setToolchain(await controller.api.configureCLIExecutable(cliPath.trim())); setCLIError('') }
    catch (reason: unknown) { setCLIError(reason instanceof Error ? reason.message : 'Could not configure CLI') }
    finally { setCLIBusy(false) }
  }
  async function chooseCoreBinary() {
    try {
      const path = await controller.api.selectRuntimeArtifactBinary()
      if (!path) return
      setCoreBinaryPath(path)
      setCoreBinaryInspection(null)
      setConfirmCoreBinaryUpdate(false)
      setCoreBinaryError('')
    } catch (reason: unknown) {
      setCoreBinaryError(messageOf(reason, 'Could not select Core binary'))
    }
  }
  async function inspectCoreBinary() {
    const path = coreBinaryPath.trim()
    if (!path || coreBinaryBusy) return
    setCoreBinaryBusy(true)
    setCoreBinaryError('')
    setConfirmCoreBinaryUpdate(false)
    setCoreBinaryInspection(null)
    try {
      const inspection = JSON.parse(await controller.api.inspectCoreBinary(path)) as { digest: string; platform: string; sizeBytes: number }
      if (!inspection.digest.startsWith('sha256:') || !inspection.platform.startsWith('linux/') || !Number.isSafeInteger(inspection.sizeBytes) || inspection.sizeBytes <= 0) {
        throw new Error('CLI returned invalid Core binary inspection')
      }
      setCoreBinaryInspection(inspection)
    } catch (reason: unknown) {
      setCoreBinaryError(messageOf(reason, 'Could not inspect Core binary'))
    } finally { setCoreBinaryBusy(false) }
  }
  async function updateCoreBinary() {
    if (!coreBinaryInspection || !coreBinaryPath || coreBinaryBusy) return
    setCoreBinaryBusy(true)
    setCoreBinaryError('')
    try {
      await controller.api.updateLocalCoreBinary(coreBinaryPath, coreBinaryInspection.digest, true)
      setCoreBinaryPath('')
      setCoreBinaryInspection(null)
      setConfirmCoreBinaryUpdate(false)
    } catch (reason: unknown) {
      setCoreBinaryError(messageOf(reason, 'Could not update Core'))
    } finally { setCoreBinaryBusy(false) }
  }
  async function reloadCoreSettings() {
    setCoreSettingsBusy(true)
    setCoreSettingsError('')
    try {
      const view = await controller.api.readCoreSettings()
      setCoreSettings(view)
      setCoreSettingsDraft({
        maxBodyBytes: String(view.settings.management.maxBodyBytes),
        headerTimeout: view.settings.management.headerTimeout,
        requestTimeout: view.settings.management.requestTimeout,
      })
      setConfirmCoreSettingsApply(false)
    } catch (reason: unknown) {
      setCoreSettingsError(messageOf(reason, locale === 'ru' ? 'Не удалось прочитать настройки Core' : 'Could not read Core settings'))
    } finally { setCoreSettingsBusy(false) }
  }
  async function restartCoreOnly() {
    if (coreSettingsBusy) return
    setCoreSettingsBusy(true)
    setCoreSettingsError('')
    try {
      await controller.api.runStudioCommandAndWait('core.restart', 'local', '', '')
      const view = await controller.api.readCoreSettings()
      setCoreSettings(view)
      setCoreSettingsDraft({ maxBodyBytes: String(view.settings.management.maxBodyBytes), headerTimeout: view.settings.management.headerTimeout, requestTimeout: view.settings.management.requestTimeout })
    } catch (reason: unknown) {
      setCoreSettingsError(messageOf(reason, locale === 'ru' ? 'Core не восстановил доступность после перезапуска' : 'Core did not recover after restart'))
      try { setCoreSettings(await controller.api.readCoreSettings()) } catch { /* preserve the actionable restart error */ }
    } finally { setCoreSettingsBusy(false) }
  }
  async function applyCoreSettings() {
    if (!coreSettings || coreSettingsBusy || coreSettings.pending || coreSettings.restartRequired) return
    const maxBodyBytes = Number(coreSettingsDraft.maxBodyBytes)
    if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 16 * 1024 * 1024) {
      setCoreSettingsError(locale === 'ru' ? 'Лимит тела запроса должен быть целым числом от 1 до 16777216 байт.' : 'Body limit must be an integer between 1 and 16777216 bytes.')
      return
    }
    setCoreSettingsBusy(true)
    setCoreSettingsError('')
    setConfirmCoreSettingsApply(false)
    try {
      const view = await controller.api.updateCoreSettings(coreSettings.desiredRevision, maxBodyBytes, coreSettingsDraft.headerTimeout, coreSettingsDraft.requestTimeout)
      setCoreSettings(view)
      if (view.restartRequired || view.pending) {
        // The confirmation above covers the brief Core-only restart. CLI's
        // Core lifecycle command deliberately leaves service containers alive.
        await controller.api.runStudioCommandAndWait('core.restart', 'local', '', '')
      }
      const refreshed = await controller.api.readCoreSettings()
      setCoreSettings(refreshed)
      setCoreSettingsDraft({ maxBodyBytes: String(refreshed.settings.management.maxBodyBytes), headerTimeout: refreshed.settings.management.headerTimeout, requestTimeout: refreshed.settings.management.requestTimeout })
    } catch (reason: unknown) {
      setCoreSettingsError(messageOf(reason, locale === 'ru' ? 'Не удалось применить настройки Core' : 'Could not apply Core settings'))
      try { const refreshed = await controller.api.readCoreSettings(); setCoreSettings(refreshed); setCoreSettingsDraft({ maxBodyBytes: String(refreshed.settings.management.maxBodyBytes), headerTimeout: refreshed.settings.management.headerTimeout, requestTimeout: refreshed.settings.management.requestTimeout }) } catch { /* keep the initial failure visible and allow explicit retry */ }
    } finally { setCoreSettingsBusy(false) }
  }
  useEffect(() => { if (category === 'core') void reloadCoreSettings() }, [category, controller])
  const coreSettingsChanged = Boolean(coreSettings && (
    coreSettingsDraft.maxBodyBytes !== String(coreSettings.settings.management.maxBodyBytes) ||
    coreSettingsDraft.headerTimeout !== coreSettings.settings.management.headerTimeout ||
    coreSettingsDraft.requestTimeout !== coreSettings.settings.management.requestTimeout
  ))

  return (
    <section className="settings-view settings-center">
      <div className="settings-sidebar"><div className="settings-header"><span className="eyebrow">Studio</span><h1>{t.settingsTitle}</h1></div>{([['plugins', locale === 'ru' ? 'Плагины' : 'Plugins'], ['services', locale === 'ru' ? 'Сервисы и версии' : 'Services & versions'], ['secrets', locale === 'ru' ? 'Секреты' : 'Secrets'], ['docker', 'Docker'], ['editor', locale === 'ru' ? 'Редактор' : 'Editor'], ['appearance', locale === 'ru' ? 'Внешний вид' : 'Appearance'], ['language', t.language], ['toolchain', locale === 'ru' ? 'Инструменты и CLI' : 'Toolchain & CLI'], ['core', 'Local Core']] as const).map(([id, label]) => <button type="button" key={id} className={`settings-nav-item ${category === id ? 'active' : ''}`} onClick={() => { setCategory(id); }}>{label}</button>)}</div>
      <div className="settings-content">
        {category === 'plugins' && <div className="settings-section"><h3>{locale === 'ru' ? 'Каталог и установленные плагины Studio' : 'Studio plugin catalog and installed versions'}</h3>{pluginManager}</div>}
        {category === 'services' && <div className="settings-section"><h3>{locale === 'ru' ? 'Локальный каталог сервисов' : 'Local service package catalog'}</h3><p className="muted">{locale === 'ru' ? 'Здесь хранятся проверенные локальные бинарники и их версии. Каталог не загружает пакеты из сети.' : 'Trusted local binaries and their versions live here. Packages are not downloaded from a remote catalog.'}</p>{artifactsManager}</div>}
        {category === 'secrets' && <LocalServiceSecretsSettings controller={controller} workspace={workspace} locale={locale} />}
        {category === 'docker' && <div className="settings-section"><h3>{locale === 'ru' ? 'Docker Engine и контейнеры' : 'Docker Engine and containers'}</h3><p className="muted">{locale === 'ru' ? 'CLI управляет Docker для активного target и запускает все подключённые сервисы проекта.' : 'The CLI manages Docker for the active target and runs all connected project services.'}</p><div className="setup-row"><button className="secondary-button compact" onClick={() => void controller.run('runtime.status')}><RefreshCw size={14} />{locale === 'ru' ? 'Состояние' : 'Status'}</button><button className="primary-button compact" onClick={() => void controller.run('runtime.start')}><Play size={14} />{locale === 'ru' ? 'Запустить проект' : 'Run project'}</button><button className="secondary-button compact" onClick={() => void controller.run('runtime.restart')}><RefreshCw size={14} />{locale === 'ru' ? 'Перезапустить проект' : 'Restart project'}</button></div></div>}
        {category === 'editor' && <div className="settings-section editor-settings"><h3>{locale === 'ru' ? 'Внешний редактор' : 'External editor'}</h3><p className="muted">{locale === 'ru' ? 'Файлы открываются вне Studio. Без глобального правила используется приложение по умолчанию в системе.' : 'Files open outside Studio. With no global rule, Studio uses the operating system default.'}</p><div className="setup-row"><input readOnly value={editorApplication} placeholder={locale === 'ru' ? 'Выберите приложение…' : 'Choose an application…'} aria-label="Editor application" /><button className="secondary-button compact" onClick={() => void chooseEditor()}><FolderOpen size={14} />Browse</button><button className="primary-button compact" disabled={!editorApplication.trim()} onClick={() => void saveEditor('*')}>Set global</button><button className="secondary-button compact" onClick={() => void removeEditor('*')}>Use OS default</button></div><div className="setup-row"><input value={editorPattern} onChange={(event) => { setEditorPattern(event.target.value); }} placeholder="*.yaml" aria-label="File mask" /><button className="primary-button compact" disabled={!editorApplication.trim() || !editorPattern.trim()} onClick={() => void saveEditor(editorPattern.trim())}>Add association</button></div>{editorError && <p className="inline-error" role="alert">{editorError}</p>}{editorAssociations.length > 0 && <div className="editor-association-list">{editorAssociations.map((association) => <div className="editor-association" key={association.pattern}><code>{association.pattern}</code><span title={association.application}>{association.application}</span><button type="button" className="icon-button small" title="Remove association" aria-label={`Remove ${association.pattern}`} onClick={() => void removeEditor(association.pattern)}><Trash2 size={14} /></button></div>)}</div>}</div>}
        {category === 'appearance' && <div className="settings-section"><h3>{t.theme}</h3><p className="muted">{locale === 'ru' ? 'Интерфейс использует только чёрный, белый и нейтральные оттенки. Цвет логотипа не меняется.' : 'The interface uses black, white and neutral grays. The logo color is preserved.'}</p><div className="segmented"><button className={theme === 'system' ? 'active' : ''} onClick={() => void controller.setTheme('system')}>System</button><button className={theme === 'light' ? 'active' : ''} onClick={() => void controller.setTheme('light')}><Sun size={14} />{t.light}</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => void controller.setTheme('dark')}><Moon size={14} />{t.dark}</button></div></div>}
        {category === 'language' && <div className="settings-section"><h3>{t.language}</h3><div className="segmented"><button className={locale === 'ru' ? 'active' : ''} onClick={() => void controller.setLocale('ru')}>Русский</button><button className={locale === 'en' ? 'active' : ''} onClick={() => void controller.setLocale('en')}>English</button></div></div>}
        {category === 'toolchain' && <div className="settings-section"><h3>Toolchain</h3><div className="toolchain-card"><Terminal size={18} /><span><strong>{toolchain?.cliAvailable ? toolchain.cliPath : t.cliMissing}</strong><small>{toolchain?.cliVersion || toolchain?.errorCode || '—'}</small></span><span className={`status-dot ${toolchain?.cliAvailable ? 'status-success' : 'status-warning'}`} /></div><p className="muted">{locale === 'ru' ? 'Studio запускает выбранный локальный CLI. Выбирай только бинарник, которому доверяешь.' : 'Studio runs the selected local CLI. Choose only an executable you trust.'}</p><div className="setup-row"><input value={cliPath} onChange={(event) => { setCLIPath(event.target.value); setCLIError('') }} placeholder={locale === 'ru' ? 'Путь к бинарнику liapoldus…' : 'Path to liapoldus executable…'} aria-label="CLI executable" /><button className="secondary-button compact" onClick={() => void chooseCLI()}><FolderOpen size={14} />{locale === 'ru' ? 'Выбрать' : 'Browse'}</button><button className="primary-button compact" disabled={!cliPath.trim() || cliBusy} onClick={() => void configureCLI()}>{locale === 'ru' ? 'Использовать CLI' : 'Use CLI'}</button></div>{cliError && <p className="inline-error" role="alert">{cliError}</p>}</div>}
        {category === 'core' && <div className="settings-section"><h3>Local Core setup</h3><div className="setup-row"><select value={target} onChange={(event) => { setField('target', event.target.value) }}><option value="local">local</option></select><button className="secondary-button compact" onClick={() => void controller.run('target.list')}>List targets</button><button className="secondary-button compact" onClick={() => void controller.run('target.test')}>Test</button><button className="secondary-button compact" onClick={() => void controller.run('core.status')}>Status</button><button className="secondary-button compact" onClick={() => void controller.run('credential.status')}>{locale === 'ru' ? 'Доступ' : 'Credential'}</button></div><div className="setup-row"><input readOnly value={profile} placeholder="No target profile selected" /><button className="secondary-button compact" onClick={() => void controller.api.selectTargetProfile().then((value) => { if (value) setField('profile', value) })}>Choose profile</button><button className="primary-button compact" disabled={!profile} onClick={() => void controller.api.runStudioCommand('target.add', target, '', profile)}><Plus size={14} />Register</button></div><div className="setup-row"><button className="secondary-button compact" onClick={() => void controller.run('core.start')}><Play size={14} />Start Core</button><button className="secondary-button compact" onClick={() => void controller.run('core.stop')}>Stop Core</button><button className="secondary-button compact" onClick={() => void controller.run('core.logs')}>Logs</button></div><h3>{locale === 'ru' ? 'Обновить Core binary' : 'Update Core binary'}</h3><p className="muted">{locale === 'ru' ? 'Укажи готовый Linux binary. CLI проверит платформу и SHA-256; путь и digest сохраняются только в CLI target registry.' : 'Choose an existing Linux binary. The CLI verifies platform and SHA-256; path and digest are stored only in the CLI target registry.'}</p><div className="setup-row"><input value={coreBinaryPath} onChange={(event) => { setCoreBinaryPath(event.target.value); setCoreBinaryInspection(null); setConfirmCoreBinaryUpdate(false); setCoreBinaryError('') }} placeholder="/path/to/core" aria-label="Core binary path" /><button className="secondary-button compact" disabled={coreBinaryBusy} onClick={() => void chooseCoreBinary()}><FolderOpen size={14} />{locale === 'ru' ? 'Выбрать' : 'Browse'}</button><button className="secondary-button compact" disabled={!coreBinaryPath.trim() || coreBinaryBusy} onClick={() => void inspectCoreBinary()}>{locale === 'ru' ? 'Проверить binary' : 'Inspect binary'}</button>{coreBinaryInspection && <span className="muted">{coreBinaryInspection.platform} · {coreBinaryInspection.digest}</span>}<button className="primary-button compact" disabled={!coreBinaryInspection || coreBinaryBusy} onClick={() => { if (confirmCoreBinaryUpdate) void updateCoreBinary(); else setConfirmCoreBinaryUpdate(true) }}><RefreshCw size={14} />{confirmCoreBinaryUpdate ? (locale === 'ru' ? 'Подтвердить обновление Core' : 'Confirm Core update') : (locale === 'ru' ? 'Доверить и обновить Core' : 'Review Core update')}</button></div>{confirmCoreBinaryUpdate && coreBinaryInspection && <div className="dialog-hint" role="alertdialog" aria-label={locale === 'ru' ? 'Подтверждение обновления Core' : 'Confirm Core update'}><strong>{locale === 'ru' ? `Будет запущен ${coreBinaryInspection.platform}, SHA-256 ${coreBinaryInspection.digest}.` : `Will run ${coreBinaryInspection.platform}, SHA-256 ${coreBinaryInspection.digest}.`}</strong><p>{locale === 'ru' ? 'Core может кратко стать недоступен. CLI сохранит новую ссылку только после readiness; при ошибке Core может остаться остановленным. SQLite migrations автоматически не откатываются. Контейнеры Server/Echo и их данные не изменяются.' : 'Core may briefly become unavailable. CLI commits the new reference only after readiness; on failure Core may remain stopped. SQLite migrations are not automatically rolled back. Server/Echo containers and their data are not changed.'}</p><button type="button" className="secondary-button compact" onClick={() => { setConfirmCoreBinaryUpdate(false) }}>{locale === 'ru' ? 'Отмена' : 'Cancel'}</button></div>}{coreBinaryError && <p className="inline-error" role="alert">{coreBinaryError}</p>}</div>}
        {category === 'core' && <div className="settings-section core-settings-editor">
          <div className="section-heading-row"><div><h3>{locale === 'ru' ? 'Конфигурация Core' : 'Core configuration'}</h3><p className="muted">{locale === 'ru' ? 'Настройки читаются и применяются через CLI → Core Management API. Секреты и пути к файлам не попадают в UI.' : 'Settings are read and applied through CLI → Core Management API. Secrets and file paths never enter the UI.'}</p></div><button className="secondary-button compact" disabled={coreSettingsBusy} onClick={() => void reloadCoreSettings()}><RefreshCw size={14} />{locale === 'ru' ? 'Обновить' : 'Refresh'}</button></div>
          {coreSettings && <>
            <div className="core-settings-revisions"><span>Target <strong>{coreSettings.target}</strong></span><span>{locale === 'ru' ? 'Желаемая' : 'Desired'} <strong>{coreSettings.desiredRevision}</strong></span><span>{locale === 'ru' ? 'Действующая' : 'Effective'} <strong>{coreSettings.effectiveRevision}</strong></span><span className={coreSettings.pending || coreSettings.restartRequired ? 'state-warning' : 'state-success'}>{coreSettings.pending || coreSettings.restartRequired ? (locale === 'ru' ? 'Нужен перезапуск' : 'Restart required') : (locale === 'ru' ? 'Синхронизировано' : 'In sync')}</span></div>
            <div className="core-settings-fields">
              <label>{locale === 'ru' ? 'Management listen · просмотр' : 'Management listen · read only'}<input readOnly value={coreSettings.settings.management.listen} /></label>
              <label>{locale === 'ru' ? 'Максимальный размер тела (байт)' : 'Maximum body size (bytes)'}<input type="number" min={1} max={16777216} step={1} value={coreSettingsDraft.maxBodyBytes} disabled={coreSettingsBusy || coreSettings.pending || coreSettings.restartRequired} onChange={(event) => { setCoreSettingsDraft((current) => ({ ...current, maxBodyBytes: event.target.value })) }} /></label>
              <label>Header timeout<input value={coreSettingsDraft.headerTimeout} placeholder="5s" disabled={coreSettingsBusy || coreSettings.pending || coreSettings.restartRequired} onChange={(event) => { setCoreSettingsDraft((current) => ({ ...current, headerTimeout: event.target.value })) }} /></label>
              <label>Request timeout<input value={coreSettingsDraft.requestTimeout} placeholder="30s" disabled={coreSettingsBusy || coreSettings.pending || coreSettings.restartRequired} onChange={(event) => { setCoreSettingsDraft((current) => ({ ...current, requestTimeout: event.target.value })) }} /></label>
            </div>
            {coreSettings.pending || coreSettings.restartRequired
              ? <div className="setup-row"><p className="muted">{locale === 'ru' ? 'Desired revision сохранена, но ещё не действует. До восстановления Core новые изменения заблокированы.' : 'The desired revision is saved but not effective. New changes are blocked until Core recovers.'}</p><button className="primary-button compact" disabled={coreSettingsBusy} onClick={() => { void restartCoreOnly() }}><RefreshCw size={14} />{locale === 'ru' ? 'Повторить перезапуск Core' : 'Retry Core restart'}</button></div>
              : <div className="setup-row"><button className="primary-button compact" disabled={!coreSettingsChanged || coreSettingsBusy} onClick={() => { setConfirmCoreSettingsApply(true) }}><Check size={14} />{locale === 'ru' ? 'Применить и перезапустить Core' : 'Apply & restart Core'}</button></div>}
            {confirmCoreSettingsApply && coreSettingsChanged && <div className="dialog-hint" role="alertdialog" aria-label={locale === 'ru' ? 'Подтвердить изменения Core' : 'Confirm Core settings'}><strong>{locale === 'ru' ? `Будет обновлена desired revision ${String(coreSettings.desiredRevision)}; перезапустится только Core.` : `Desired revision ${String(coreSettings.desiredRevision)} will be updated; only Core will restart.`}</strong><p>{locale === 'ru' ? 'Management API будет кратко недоступен. Контейнеры Server/Echo останутся запущенными. При сбое перезапуска Studio покажет pending revision и отдельный retry.' : 'The Management API will briefly be unavailable. Server/Echo containers remain running. If restart fails, Studio shows the pending revision and a separate retry action.'}</p><div className="setup-row"><button className="primary-button compact" disabled={coreSettingsBusy} onClick={() => { void applyCoreSettings() }}>{locale === 'ru' ? 'Подтвердить и выполнить' : 'Confirm and apply'}</button><button className="secondary-button compact" disabled={coreSettingsBusy} onClick={() => { setConfirmCoreSettingsApply(false) }}>{locale === 'ru' ? 'Отмена' : 'Cancel'}</button></div></div>}
          </>}
          {!coreSettings && !coreSettingsBusy && !coreSettingsError && <p className="muted">{locale === 'ru' ? 'Нажмите «Обновить», чтобы прочитать настройки локального Core.' : 'Select Refresh to read settings from local Core.'}</p>}
          {coreSettingsError && <p className="inline-error" role="alert">{coreSettingsError}</p>}
        </div>}
        {category === 'core' && <div className="settings-section"><div className="setup-row"><button className="secondary-button compact" onClick={() => void controller.run('target.inspect')}>{t.inspectTarget}</button><button className="secondary-button compact" onClick={() => void controller.run('core.settings.inspect')}>{locale === 'ru' ? 'Настройки Core · CLI output' : 'Core settings · CLI output'}</button></div></div>}
      </div>
    </section>
  )
}

export function CommandPalette({ controller, t, onSettings }: { controller: StudioController; t: Copy; onSettings: () => void }) {
  const close = useStudioStore((state) => state.setCommandOpen)
  const query = useStudioStore((state) => state.commandQuery)
  const setField = useStudioStore((state) => state.setField)
  const navigate = useStudioStore((state) => state.navigate)
  const commands: Array<[string, string, () => void]> = [
    [t.graph, 'Open service graph', () => { navigate('canvas'); }],
    [t.problems, 'Open diagnostics', () => { navigate('problems'); }],
    ['Validate', 'Run liapoldus validate', () => void controller.run('validate')],
    ['Local Core', 'Show local Core status', () => void controller.run('core.status')],
    [t.inspectTarget, t.inspectTargetHint, () => void controller.run('target.inspect')],
    [t.settings, 'Open preferences', onSettings],
  ]
  const filtered = commands.filter(([label, detail]) => `${label} ${detail}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(false) }}><div className="command-modal"><div className="command-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => { setField('commandQuery', event.target.value) }} placeholder={t.command} /><kbd>Esc</kbd></div><div className="command-results">{filtered.map(([label, detail, action]) => <button key={label} onClick={() => { action(); close(false) }}><span><strong>{label}</strong><small>{detail}</small></span><span>›</span></button>)}</div></div></div>
}

export function CreateProjectDialog({ controller, t }: { controller: StudioController; t: Copy }) { const close = useStudioStore((state) => state.setCreateOpen); const id = useStudioStore((state) => state.projectID); const name = useStudioStore((state) => state.projectName); const setField = useStudioStore((state) => state.setField); return <div className="modal-backdrop"><form className="dialog" onSubmit={(event) => { event.preventDefault(); void controller.createProject() }}><div className="dialog-heading"><div><span className="eyebrow">Project</span><h2>{t.create}</h2></div><button type="button" className="icon-button" onClick={() => { close(false); }}><X size={17} /></button></div><label>Project id<input autoFocus value={id} onChange={(event) => { setField('projectID', event.target.value); }} placeholder="my-project" /></label><label>Name<input value={name} onChange={(event) => { setField('projectName', event.target.value); }} placeholder="My Project" /></label><p className="dialog-hint">A new project folder will be created in the selected parent directory.</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { close(false); }}>{t.close}</button><button className="primary-button" type="submit"><Plus size={15} />{t.create}</button></div></form></div> }
export function ServiceDialog({ controller, t }: { controller: StudioController; t: Copy }) {
  const close = useStudioStore((state) => state.setServiceOpen)
  const name = useStudioStore((state) => state.serviceName)
  const setField = useStudioStore((state) => state.setField)
  const workspace = useStudioStore((state) => state.workspace)
  const [artifacts, setArtifacts] = useState<ArtifactReference[]>([])
  const [artifactKey, setArtifactKey] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { void controller.listArtifacts().then(setArtifacts) }, [controller])
  const selectedArtifact = artifacts.find((artifact) => `${artifact.id}@${artifact.version}#${artifact.platform}` === artifactKey)
  const available = selectedArtifact?.trusted && !workspace?.graph.services.some((service) => service.id === selectedArtifact.id)
  return <div className="modal-backdrop"><form className="dialog" onSubmit={(event) => { event.preventDefault(); if (selectedArtifact && available && name.trim()) { void controller.addService(selectedArtifact, name).catch((reason: unknown) => { setError(messageOf(reason, 'Could not connect service')) }) } }}><div className="dialog-heading"><div><span className="eyebrow">{t.runtimeService}</span><h2>{t.newService}</h2></div><button type="button" className="icon-button" onClick={() => { close(false); }}><X size={17} /></button></div>
    <label>{localeLabel(t, 'Пакет из установленного каталога', 'Package from installed catalog')}<select autoFocus value={artifactKey} onChange={(event) => { setArtifactKey(event.target.value); const artifact = artifacts.find((item) => `${item.id}@${item.version}#${item.platform}` === event.target.value); if (artifact) { setField('serviceID', artifact.id); setField('serviceName', artifact.id.split(/[._-]/u).map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : '').join(' ')) } }}><option value="">{localeLabel(t, 'Выберите пакет…', 'Select a package…')}</option>{artifacts.map((artifact) => <option key={`${artifact.id}@${artifact.version}#${artifact.platform}`} value={`${artifact.id}@${artifact.version}#${artifact.platform}`} disabled={!artifact.trusted || workspace?.graph.services.some((service) => service.id === artifact.id)}>{artifact.id} · {artifact.version} · {artifact.platform}{artifact.trusted ? '' : ' · untrusted'}</option>)}</select></label>
    <label>{t.serviceID}<input readOnly value={selectedArtifact?.id ?? ''} placeholder="orders" /></label><label>Name<input value={name} onChange={(event) => { setField('serviceName', event.target.value); }} placeholder="Orders" /></label>{artifacts.length === 0 && <p className="muted">{localeLabel(t, 'Сначала установите локальный пакет в Настройках → Сервисы и версии.', 'Install a local package first in Settings → Services & versions.')}</p>}{error && <p className="inline-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { close(false); }}>{t.close}</button><button className="primary-button" type="submit" disabled={!available || !name.trim()}><Plus size={15} />{localeLabel(t, 'Подключить сервис', 'Connect service')}</button></div></form></div>
}

function localeLabel(_t: Copy, ru: string, en: string) { return useStudioStore.getState().locale === 'ru' ? ru : en }
