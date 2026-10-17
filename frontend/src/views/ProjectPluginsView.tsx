import { useEffect, useState } from 'react'
import { Puzzle, Plus } from 'lucide-react'
import type { StudioController } from '../controllers/studioController'
import type { StudioPluginPackageInfo } from '../models/studioPluginPackage'
import { groupStudioPluginVersions } from '../models/studioPluginPackage'
import { projectPluginVersionsFromState, workspaceStateWithProjectPluginVersions } from '../models/studio'
import { useStudioStore } from '../stores/studio'

export function ProjectPluginsView({ controller, locale }: { controller: StudioController; locale: 'ru' | 'en' }) {
  const project = useStudioStore((state) => state.workspace?.project)
  const selected = useStudioStore((state) => state.selected)
  const connected = useStudioStore((state) => state.projectPluginVersions)
  const setSelected = useStudioStore((state) => state.setSelected)
  const setProjectPluginVersions = useStudioStore((state) => state.setProjectPluginVersions)
  const [installed, setInstalled] = useState<StudioPluginPackageInfo[]>([])
  const [error, setError] = useState('')
  const groups = groupStudioPluginVersions(installed)
  const ru = locale === 'ru'

  async function reload() {
    try {
      const [packages, state] = await Promise.all([controller.installedStudioPluginPackages(), controller.api.readWorkspaceState()])
      const pins = projectPluginVersionsFromState(state)
      setInstalled(packages)
      setProjectPluginVersions(pins)
      setError('')
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  useEffect(() => { void reload() }, [controller, project?.id])

  async function connect(pluginId: string, version: string | null) {
    if (!version) return
    const next = { ...connected, [pluginId]: version }
    if (await save(next)) setSelected({ kind: 'plugin', id: pluginId })
  }

  async function save(pins: Record<string, string>): Promise<boolean> {
    if (!project) return false
    try {
      const state = await controller.api.readWorkspaceState()
      await controller.api.writeWorkspaceState(workspaceStateWithProjectPluginVersions({ ...state, projectId: project.id }, pins))
      setProjectPluginVersions(pins)
      setError('')
      return true
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)); return false }
  }

  return <section className="studio-plugin-workspace project-plugin-workspace">
    <header className="settings-header"><div><span className="eyebrow">{ru ? 'Проект' : 'Project'}</span><h1>{ru ? 'Плагины проекта' : 'Project plugins'}</h1><p>{ru ? 'Подключайте установленные плагины к проекту. Версию и параметры выбранного плагина можно изменить справа.' : 'Connect installed plugins to this Project. Choose a version and configure the selected plugin in the Inspector.'}</p></div></header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {groups.length === 0 ? <div className="settings-section plugin-empty"><Puzzle size={20} /><span>{ru ? 'Нет установленных плагинов Studio' : 'No Studio plugins installed'}</span><small>{ru ? 'Установка и управление пакетами находятся в общих настройках.' : 'Install and manage packages in global Settings.'}</small></div> : <section className="settings-section plugin-installed">
      <div className="plugin-list-heading"><h2>{ru ? 'Доступные плагины' : 'Available plugins'}</h2><span className="count">{groups.length}</span></div>
      {groups.map((group) => {
        const activeVersion = connected[group.id]
        const versions = [group.current, ...group.previous]
        const isConnected = Boolean(activeVersion && versions.some((item) => item.version === activeVersion))
        const active = selected?.kind === 'plugin' && selected.id === group.id
        return <article className={`plugin-installed-card ${active ? 'selected' : ''}`} key={group.id}>
          <button type="button" className="project-plugin-select" onClick={() => { if (isConnected) setSelected({ kind: 'plugin', id: group.id }); else void connect(group.id, group.current.version) }}>
            <Puzzle size={16} /><span><strong>{group.name}</strong><small><code>{group.id}</code> · {isConnected ? activeVersion : (ru ? 'не подключён' : 'not connected')}</small></span>
            {isConnected ? <span className="count">{ru ? 'Подключён' : 'Connected'}</span> : <span className="count"><Plus size={13} /></span>}
          </button>
        </article>
      })}
    </section>}
  </section>
}
