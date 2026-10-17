import { useEffect, useState } from 'react'
import { BadgeCheck, FileArchive, Puzzle, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import type { StudioController } from '../controllers/studioController'
import type { StudioPluginPackageInfo } from '../models/studioPluginPackage'
import { groupStudioPluginVersions } from '../models/studioPluginPackage'
import type { Copy } from '../models/copy'
import type { StudioPluginSurface } from '../stores/studio'
import type { ServiceEditorButtonCandidate } from '../models/serviceEditorButtons'
import { assignSingleServiceEditorPages } from '../models/serviceEditorButtons'
import { latestStudioPluginSurfaces } from '../models/studioPluginPackage'
import { useStudioStore } from '../stores/studio'

type Props = {
  controller: StudioController
  t: Copy
  surfaces: StudioPluginSurface[]
  onOpen: (surface: StudioPluginSurface) => void
}

export function StudioPluginsView({ controller, t, surfaces, onOpen }: Props) {
  const locale = useStudioStore((state) => state.locale)
  const projectID = useStudioStore((state) => state.workspace?.project?.id ?? '')
  const [installed, setInstalled] = useState<StudioPluginPackageInfo[]>([])
  const [packagePath, setPackagePath] = useState('')
  const [inspection, setInspection] = useState<StudioPluginPackageInfo | null>(null)
  const [trustAccepted, setTrustAccepted] = useState(false)
  const [reason, setReason] = useState('')
  const [removeTarget, setRemoveTarget] = useState<StudioPluginPackageInfo | null>(null)
  const [removeConfirmation, setRemoveConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [buttonCandidates, setButtonCandidates] = useState<ServiceEditorButtonCandidate[]>([])
  const [editorBindings, setEditorBindings] = useState<Array<{ buttonId: string; pluginId: string; surfaceId: string }>>([])
  const groups = groupStudioPluginVersions(installed)

  async function refreshInstalled() {
    try {
      const currentSurfaces = await controller.loadStudioPluginSurfaces()
      const [packages, bindings] = await Promise.all([
        controller.installedStudioPluginPackages(),
        controller.studioPluginEditorBindings(),
      ])
      setInstalled(packages)
      setEditorBindings(bindings)
      const candidates = await controller.serviceEditorButtonCandidates()
      const nextBindings = assignSingleServiceEditorPages(candidates, bindings, latestStudioPluginSurfaces(currentSurfaces))
      setInstalled(packages)
      setButtonCandidates(candidates)
      setEditorBindings(nextBindings)
      if (nextBindings.length !== bindings.length) await controller.saveStudioPluginEditorBindings(nextBindings)
      setError('')
    } catch (failure: unknown) {
      setError(messageOf(failure))
    }
  }

  async function assignButton(buttonId: string, pluginId: string, surfaceId: string) {
    if (busy) return
    const next = editorBindings.filter((item) => item.buttonId !== buttonId)
    if (surfaceId) next.push({ buttonId, pluginId, surfaceId })
    setBusy(true)
    try { await controller.saveStudioPluginEditorBindings(next); setEditorBindings(next); setError(''); setNotice(locale === 'ru' ? 'Назначение кнопки сохранено.' : 'Button assignment saved.') }
    catch (failure: unknown) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  useEffect(() => { setButtonCandidates([]); void refreshInstalled() }, [controller, projectID])
  useEffect(() => {
    const openInstaller = () => { void choosePackage() }
    window.addEventListener('studio:add-plugin', openInstaller)
    return () => { window.removeEventListener('studio:add-plugin', openInstaller) }
  }, [controller])

  async function choosePackage() {
    setError('')
    setNotice('')
    try {
      const selected = await controller.selectStudioPluginPackage()
      if (!selected) return
      setBusy(true)
      setPackagePath(selected)
      setInspection(null)
      setTrustAccepted(false)
      setReason('')
      setInspection(await controller.inspectStudioPluginPackage(selected))
    } catch (failure: unknown) {
      setPackagePath('')
      setInspection(null)
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  async function installPackage() {
    if (!inspection || !packagePath || !trustAccepted || !reason.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await controller.installStudioPluginPackage(packagePath, inspection, reason)
      setInspection(null)
      setPackagePath('')
      setTrustAccepted(false)
      setReason('')
      await refreshInstalled()
      setNotice(t.pluginInstallSuccess)
    } catch (failure: unknown) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  async function removePackage() {
    if (!removeTarget || removeConfirmation !== removeTarget.id) return
    setBusy(true)
    setError('')
    try {
      await controller.removeStudioPluginPackage(removeTarget.id, removeTarget.version)
      setRemoveTarget(null)
      setRemoveConfirmation('')
      await refreshInstalled()
    } catch (failure: unknown) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return <section className="studio-plugin-workspace">
    <header className="settings-header">
      <div><span className="eyebrow">{t.studioPlugins}</span><h1>{t.pluginManagerTitle}</h1></div>
      <div className="toolbar-actions">
        <button type="button" className="secondary-button compact" onClick={() => void refreshInstalled()} disabled={busy}><RefreshCw size={13} />{t.pluginRefresh}</button>
        <button type="button" className="primary-button compact" onClick={() => void choosePackage()} disabled={busy}><FileArchive size={14} />{t.pluginChoose}</button>
      </div>
    </header>

    {error && <div className="studio-plugin-message error" role="alert"><ShieldAlert size={15} /><span>{error}</span></div>}
    {notice && <div className="studio-plugin-message" role="status"><BadgeCheck size={15} /><span>{notice}</span></div>}

    <section className="settings-section plugin-editor-bindings" aria-labelledby="service-editor-bindings-title">
      <h2 id="service-editor-bindings-title">{locale === 'ru' ? 'Редакторы сервисов' : 'Service editors'}</h2>
      <p className="muted">{locale === 'ru' ? 'Выберите страницу плагина для кнопки сервиса. Назначение действует во всей Studio; кнопка открывает редактор выбранного сервиса в отдельной вкладке.' : 'Assign a plugin page to a service button. Assignments apply across Studio; the button opens the selected service editor in a separate tab.'}</p>
      {!projectID ? <p role="status">{locale === 'ru' ? 'Откройте проект, чтобы получить кнопки из контрактов его сервисов. Сохранённые назначения остаются действующими.' : 'Open a project to discover its service buttons. Saved assignments remain active.'}</p> : buttonCandidates.length === 0 ? <div role="status"><p>{locale === 'ru' ? 'Кнопки сервисов пока не получены. Запустите сервисы проекта и обновите список. Сервис должен объявлять service-editor-buttons/v1.' : 'No service buttons discovered. Start the project services and refresh. Services must declare service-editor-buttons/v1.'}</p><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void refreshInstalled()}><RefreshCw size={13} />{t.pluginRefresh}</button></div> : buttonCandidates.map((button) => {
        const assigned = editorBindings.find((item) => item.buttonId === button.id)
        const choices = groups.flatMap(({ current: plugin }) => plugin.surfaces.filter((surface) => surface.context === 'service' && surface.kind === 'page' && surface.route).map((surface) => ({ pluginId: plugin.id, surfaceId: surface.id, label: `${plugin.name} · ${surface.title} · ${plugin.version}` })))
        const selected = assigned ? choices.findIndex((choice) => choice.pluginId === assigned.pluginId && choice.surfaceId === assigned.surfaceId) : -1
        return <div className="plugin-binding-row" key={`${button.serviceId}:${button.id}`}><span><strong>{button.serviceName} · {button.label[locale]}</strong><small>{button.description[locale]}</small><small><code>{button.id}</code></small></span><select aria-label={`${button.serviceName} · ${button.label[locale]}`} disabled={busy || choices.length === 0} value={selected < 0 ? '' : String(selected)} onChange={(event) => { const choice = choices[Number(event.target.value)]; void assignButton(button.id, event.target.value === '' ? '' : choice.pluginId, event.target.value === '' ? '' : choice.surfaceId) }}><option value="">{assigned && selected < 0 ? (locale === 'ru' ? 'Назначенная страница недоступна' : 'Assigned page unavailable') : (locale === 'ru' ? 'Не назначен' : 'Not assigned')}</option>{choices.map((choice, index) => <option key={`${choice.pluginId}:${choice.surfaceId}`} value={String(index)}>{choice.label}</option>)}</select></div>
      })}
      {editorBindings.filter((binding) => !buttonCandidates.some((button) => button.id === binding.buttonId)).map((binding) => <div className="plugin-binding-row" key={binding.buttonId}><span><strong><code>{binding.buttonId}</code></strong><small>{locale === 'ru' ? 'Кнопка отсутствует в метаданных текущего проекта; назначение сохранено.' : 'Button absent from this project metadata; assignment retained.'}</small><small>{binding.pluginId} · {binding.surfaceId}</small></span><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void assignButton(binding.buttonId, '', '')}>{locale === 'ru' ? 'Снять назначение' : 'Unassign'}</button></div>)}
    </section>

    {(busy && !inspection) && <div className="settings-section plugin-empty" role="status">{t.pluginLoading}</div>}
    {!busy && !inspection && installed.length === 0 && <div className="settings-section plugin-empty"><Puzzle size={20} /><span>{t.pluginNoneInstalled}</span><small>{t.pluginNoPackage}</small></div>}

    {inspection && <section className="settings-section plugin-review" aria-labelledby="plugin-review-title">
      <div className="plugin-card-heading"><div><span className="eyebrow">{t.pluginReviewTitle}</span><h2 id="plugin-review-title">{inspection.name} <small>{inspection.version}</small></h2><code>{inspection.id}</code></div><button type="button" className="icon-button small" aria-label={t.pluginCancel} title={t.pluginCancel} onClick={() => { setInspection(null); setPackagePath(''); setTrustAccepted(false); }} disabled={busy}><X size={15} /></button></div>
      <div className="plugin-review-grid">
        <div><small>{t.pluginCompatibility}</small><strong>{inspection.studioRange}</strong></div>
        <div><small>{t.pluginDigest}</small><code>{inspection.digest}</code></div>
        <div><small>{t.pluginSurfaces}</small><strong>{inspection.surfaces.length}</strong></div>
        <div><small>{t.pluginTools}</small><strong>{inspection.toolIds.length}</strong></div>
        <div><small>{t.pluginSignatureLabel}</small><strong>{inspection.signed ? t.pluginSignaturePresent : t.pluginUnsigned}</strong></div>
      </div>
      <div className="plugin-permissions"><h3>{t.pluginPermissions}</h3>{inspection.permissions.length ? <ul>{inspection.permissions.map((permission) => <li key={permission}><code>{permission}</code></li>)}</ul> : <p className="muted">{t.pluginNoPermissions}</p>}</div>
      {inspection.surfaces.length > 0 && <div className="plugin-capabilities"><h3>{t.pluginSurfaces}</h3>{inspection.surfaces.map((surface) => <span key={`${surface.kind}:${surface.id}`}>{surface.kind} · {surface.title}</span>)}</div>}
      {inspection.toolIds.length > 0 && <div className="plugin-capabilities"><h3>{t.pluginTools}</h3>{inspection.toolIds.map((id) => <code key={id}>{id}</code>)}</div>}
      <p className="dialog-hint">{t.pluginGrantWarning} {t.pluginTrustHint}</p>
      <label className="plugin-trust-check"><input type="checkbox" checked={trustAccepted} onChange={(event) => { setTrustAccepted(event.target.checked) }} /><span>{t.pluginTrust}</span></label>
      <label className="plugin-reason">{t.pluginReason}<input value={reason} onChange={(event) => { setReason(event.target.value) }} placeholder={t.pluginReasonPlaceholder} maxLength={500} /></label>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setInspection(null); setPackagePath(''); }} disabled={busy}>{t.pluginCancel}</button><button type="button" className="primary-button" onClick={() => void installPackage()} disabled={busy || !trustAccepted || !reason.trim()}><Puzzle size={14} />{t.pluginInstall}</button></div>
    </section>}

    <section className="settings-section plugin-installed">
      <div className="plugin-list-heading"><h2>{t.pluginInstalled}</h2><span className="count" title={t.pluginInstalledVersions}>{groups.length} · {installed.length}</span></div>
      {installed.length === 0 ? <p className="muted">{t.pluginNoneInstalled}</p> : groups.map((group) => {
        const plugin = group.current
        return <article className="plugin-installed-card" key={plugin.id}>
        <div className="plugin-installed-main"><Puzzle size={16} /><span><strong>{plugin.name}</strong><small><code>{plugin.id}</code> · {plugin.version}</small></span><span className="plugin-signature" title={plugin.signed ? t.pluginSignaturePresent : t.pluginUnsigned}>{plugin.signed ? <BadgeCheck size={15} /> : <ShieldAlert size={15} />}</span></div>
        <code className="plugin-installed-digest">{plugin.digest}</code>
        <div className="plugin-installed-meta"><span>{plugin.surfaces.length} · {t.pluginSurfaces.toLowerCase()}</span><span>{plugin.toolIds.length} · {t.pluginTools.toLowerCase()}</span></div>
        {plugin.grantedPermissions.length > 0 && <div className="plugin-capabilities">{plugin.grantedPermissions.map((permission) => <code key={permission}>{permission}</code>)}</div>}
        {plugin.surfaces.length > 0 && <div className="plugin-open-surfaces">{plugin.surfaces.filter((surface) => surface.context === 'workspace' && surface.route).map((surface) => {
          const activeSurface = surfaces.find((item) => item.studioPluginId === plugin.id && item.version === plugin.version && item.id === surface.id)
          return activeSurface ? <button type="button" className="secondary-button compact" key={surface.id} onClick={() => { onOpen(activeSurface) }}>{surface.title}</button> : null
        })}</div>}
        <div className="plugin-installed-actions"><button type="button" className="secondary-button compact" onClick={() => { setRemoveTarget(plugin); setRemoveConfirmation(''); }} disabled={busy}><Trash2 size={13} />{t.pluginRemove}</button></div>
        {group.previous.length > 0 && <details className="plugin-version-history"><summary>{t.pluginOtherVersions} <span className="count">{group.previous.length}</span></summary><div className="plugin-version-list">{group.previous.map((previous) => <div className="plugin-version-row" key={`${previous.id}:${previous.version}`}><span><strong>{previous.version}</strong><code>{previous.digest}</code></span><button type="button" className="secondary-button compact" onClick={() => { setRemoveTarget(previous); setRemoveConfirmation(''); }} disabled={busy}><Trash2 size={13} />{t.pluginRemove}</button></div>)}</div></details>}
      </article>
      })}
    </section>

    {removeTarget && <div className="modal-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-remove-heading">
      <div className="dialog-heading"><div><span className="eyebrow">{t.pluginRemove}</span><h2 id="plugin-remove-heading">{t.pluginRemoveConfirm}</h2></div><button type="button" className="icon-button" aria-label={t.pluginCancel} onClick={() => { setRemoveTarget(null); setRemoveConfirmation(''); }}><X size={16} /></button></div>
      <p className="dialog-hint"><strong>{removeTarget.name} · {removeTarget.version}</strong></p>
      <label className="plugin-reason">{t.pluginRemoveTyped}<input autoFocus value={removeConfirmation} onChange={(event) => { setRemoveConfirmation(event.target.value) }} /></label>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setRemoveTarget(null); setRemoveConfirmation(''); }}>{t.pluginCancel}</button><button type="button" className="primary-button" onClick={() => void removePackage()} disabled={busy || removeConfirmation !== removeTarget.id}><Trash2 size={14} />{t.pluginRemove}</button></div>
    </section></div>}
  </section>
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
