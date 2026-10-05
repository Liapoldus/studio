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
        <p>{info?.description ?? 'Десктопное приложение для подключения к Core и управления сервисами Liapoldus.'}</p>
      </section>

      <section className="connections-card">
        <div>
          <p className="eyebrow">Подключения</p>
          <h2>Core API</h2>
          <p>{info?.singleCoreBinding
            ? 'Эта web-инсталляция работает только с одним Core, заданным при запуске сервера.'
            : 'Desktop-версия сможет подключаться напрямую или через SSH-мост.'}</p>
        </div>
        {!info?.singleCoreBinding && (
          <button type="button" disabled title="Каркас интерфейса: подключение будет реализовано позже">
            Добавить подключение
          </button>
        )}
        <small>{info?.singleCoreBinding
          ? 'В web-версии нет SSH-моста и выбора другой Core-системы.'
          : 'Каркас: фактические Core API и SSH-подключения пока не реализованы.'}</small>
      </section>

      <footer>Слой доступа: {info?.coreAccessModes.join(' · ') ?? 'direct · ssh-bridge'}</footer>
    </main>
  )
}

export default App
