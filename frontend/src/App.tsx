import { useEffect, useState } from 'react'
import './App.css'
import type { ProductInfo, StudioAPI } from './api/types'

type Props = { api: StudioAPI }

function App({ api }: Props) {
  const [info, setInfo] = useState<ProductInfo | null>(null)

  useEffect(() => {
    void api.productInfo().then(setInfo)
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
          <h2>Проект и дерево файлов</h2>
          <p>Studio открывает локальный проект, индексирует файлы конфигурации и показывает Git-версию источника.</p>
        </div>
        <div className="workspace-list" role="list">
          <span role="listitem">project.yaml</span>
          <span role="listitem">services/</span>
          <span role="listitem">modules/</span>
          <span role="listitem">.git/</span>
        </div>
        <small>Deploy и runtime наблюдения выполняются standalone CLI; Studio импортирует только безопасные reports.</small>
      </section>

      <footer>Возможности: {info?.workspaceFeatures.join(' · ') ?? 'project · file-tree · git · cli-reports'}</footer>
    </main>
  )
}

export default App
