import { useEffect, useState } from 'react'
import './App.css'
import type { ProductInfo, StudioAPI, Workspace } from './api/types'

type Props = { api: StudioAPI }

function App({ api }: Props) {
  const [info, setInfo] = useState<ProductInfo | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)

  useEffect(() => {
    void api.productInfo().then(setInfo)
    void api.workspace().then(setWorkspace)
  }, [])

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="studio-mark" aria-hidden="true">L</div>
        <div>
          <p className="eyebrow">Liapoldus ecosystem</p>
          <h1>{info?.name ?? 'Liapoldus Studio'}</h1>
        </div>
      </header>

      <section className="welcome-card">
        <p className="eyebrow">Desktop control client</p>
        <h2>Управление экосистемой Liapoldus</h2>
        <p>{info?.description ?? 'Среда разработки проектов, конфигураций и Git-версий Liapoldus.'}</p>
      </section>

      <section className="workspace-card">
        <div>
          <p className="eyebrow">Project workspace</p>
          <h2>{workspace?.project?.name ?? 'Проект и дерево файлов'}</h2>
          <p>Studio открывает локальный проект и индексирует его source files без обращения к Core.</p>
        </div>
        <div className="workspace-list" role="list">
          {(workspace?.files ?? []).slice(0, 12).map((file) => (
            <span role="listitem" key={file.path}>{file.path}</span>
          ))}
          {!workspace?.files.length && <span role="listitem">Откройте проект через STUDIO_PROJECT_ROOT</span>}
        </div>
        <small>Deploy и runtime наблюдения выполняются standalone CLI; Studio импортирует только безопасные reports.</small>
      </section>

      <footer>Возможности: {info?.workspaceFeatures.join(' · ') ?? 'project · file-tree · git · cli-reports'}</footer>
    </main>
  )
}

export default App
