import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, RotateCw, Trash2 } from 'lucide-react'
import type { Locale, Workspace } from '../api/types'
import type { StudioController } from '../controllers/studioController'
import { applySavedServiceSecretRotation, replaceServiceSecretReferencesAndSave } from '../controllers/serviceSecretRotation'
import { parseServiceRuntimeStatus, projectSettingsApplied } from '../models/runtime'
import { messageOf } from '../models/studio'
import { parseDeclaredSecretPurposes, parseServiceSecretCatalogDetails, parseServiceSecretRotationResult, serviceSecretJSONPointer, serviceSecretReferencePaths, type PendingServiceSecretRotation, type ServiceSecretReference } from '../models/serviceSecrets'
import { useStudioStore } from '../stores/studio'

export function LocalServiceSecretsSettings({ controller, workspace, locale }: { controller: StudioController; workspace: Workspace | null; locale: Locale }) {
  const api = controller.api
  const services = workspace?.graph.services ?? []
  const [serviceID, setServiceID] = useState('')
  const [purposes, setPurposes] = useState<string[]>([])
  const [items, setItems] = useState<ServiceSecretReference[]>([])
  const [stagedRotations, setStagedRotations] = useState<PendingServiceSecretRotation[]>([])
  const [pendingRegistrations, setPendingRegistrations] = useState<ReturnType<typeof parseServiceSecretCatalogDetails>['pendingRegistrations']>([])
  const [purpose, setPurpose] = useState('')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [confirmCreate, setConfirmCreate] = useState(false)
  const [rotationReference, setRotationReference] = useState('')
  const [pendingRotation, setPendingRotation] = useState<{ previous: string; created: ServiceSecretReference; paths: string[][] | null; reviewPaths: string[][] } | null>(null)
  const [rotationReady, setRotationReady] = useState(false)
  const [confirmRotationApply, setConfirmRotationApply] = useState(false)
  const [rotationApplyIntent, setRotationApplyIntent] = useState<'apply' | 'retry-failed' | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const applyRecoveryStatus = useStudioStore((state) => state.applyRecoveryStatus)
  const applyRecoveryOperationId = useStudioStore((state) => state.applyRecoveryOperationId)
  const cliStreamState = useStudioStore((state) => state.cliStreamState)
  const russian = locale === 'ru'
  const selectedService = useMemo(() => services.find((service) => service.id === serviceID), [services, serviceID])

  useEffect(() => {
    if (!serviceID && services.length) setServiceID(services[0].id)
    if (serviceID && !services.some((service) => service.id === serviceID)) setServiceID(services[0]?.id ?? '')
  }, [services, serviceID])

  const reload = useCallback(async () => {
    if (!serviceID || !api.readLocalServiceSecretReferences) return
    setBusy(true)
    setError('')
    try {
      const [manifestJSON, catalogJSON] = await Promise.all([
        api.readRuntimeServiceMetadata(workspace?.project?.id ?? '', serviceID, 'manifest'),
        api.readLocalServiceSecretReferences(serviceID),
      ])
      const nextPurposes = parseDeclaredSecretPurposes(manifestJSON, serviceID)
      setPurposes(nextPurposes)
      const catalog = parseServiceSecretCatalogDetails(catalogJSON, serviceID)
      setItems(catalog.items)
      setStagedRotations(catalog.pendingRotations)
      setPendingRegistrations(catalog.pendingRegistrations)
      setPurpose((current) => nextPurposes.includes(current) ? current : nextPurposes[0] ?? '')
    } catch (reason: unknown) {
      setError(messageOf(reason, russian
        ? 'Не удалось загрузить каталог секретов. Проверьте версию CLI и доступность local Core, затем нажмите «Обновить».'
        : 'Could not load the secret catalog. Check the CLI version and local Core availability, then retry.'))
      setPurposes([])
      setItems([])
      setStagedRotations([])
      setPendingRegistrations([])
    } finally { setBusy(false) }
  }, [api, serviceID, workspace?.project?.id])

  useEffect(() => { setItems([]); setStagedRotations([]); setPendingRegistrations([]); setPurposes([]); setError(''); setNotice(''); setSecret(''); setConfirmCreate(false); setConfirmRevoke(''); setRotationReference(''); setPendingRotation(null); setConfirmRotationApply(false); setRotationApplyIntent(null); void reload() }, [reload])

  async function create() {
    if (!selectedService || (!rotationReference && !api.createLocalServiceSecret) || (rotationReference && !api.rotateLocalServiceSecret) || !purpose || !label.trim() || !secret || busy) return
    if (!confirmCreate) { setConfirmCreate(true); return }
    const encoded = new TextEncoder().encode(secret)
    const byteValues = Array.from(encoded)
    setSecret('')
    setConfirmCreate(false)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (rotationReference) {
        const raw = await api.rotateLocalServiceSecret?.(selectedService.id, rotationReference, purpose, label.trim(), byteValues, true)
        if (typeof raw !== 'string') throw new Error('Secret rotation is unavailable')
        const created = parseServiceSecretRotationResult(raw, selectedService.id, rotationReference, purpose)
        setPendingRotation({ previous: rotationReference, created, paths: null, reviewPaths: [] })
        setRotationReady(false)
        setRotationApplyIntent(null)
        setNotice(russian
          ? `Новая ссылка ${created.reference} создана и доступна для безопасной замены в конфигурации Project.`
          : `New reference ${created.reference} is staged and ready for a reviewed Project configuration replacement.`)
      } else {
        await api.createLocalServiceSecret?.(selectedService.id, purpose, label.trim(), byteValues, true)
        setNotice(russian ? 'Секрет сохранён в локальном vault. В Project и редактор попадает только opaque reference.' : 'Secret saved in the local vault. Only its opaque reference enters the Project and editor.')
      }
      setLabel('')
      setRotationReference('')
      await reloadAfterMutation()
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось сохранить секрет.' : 'Could not save the secret.'))
    } finally { encoded.fill(0); byteValues.fill(0); setBusy(false) }
  }

  async function previewRotation() {
    if (!pendingRotation || !workspace?.project || !selectedService || busy) return
    setBusy(true)
    setError('')
    try {
      const settings = await controller.pluginReadServiceSettings(workspace.project.id, selectedService.id)
      if (settings.status !== 'clean' || Object.keys(settings.patch).length > 0) {
        throw new Error(russian ? 'Сначала сохраните или отмените текущие изменения настроек сервиса.' : 'Save or discard the service settings draft before reviewing rotation.')
      }
      const paths = serviceSecretReferencePaths(settings.values, pendingRotation.previous)
      if (paths.length > 0) {
        setPendingRotation((current) => current && current.previous === pendingRotation.previous ? { ...current, paths, reviewPaths: paths } : current)
        setRotationReady(false)
      } else {
        const replacementPaths = serviceSecretReferencePaths(settings.values, pendingRotation.created.reference)
        if (replacementPaths.length === 0) throw new Error(russian ? 'Конфигурация Project не содержит ни старую, ни новую ссылку. Ротация сохранена; проверьте конфигурацию перед продолжением.' : 'The Project configuration contains neither reference. The staged rotation is preserved; review the configuration before continuing.')
        setPendingRotation((current) => current && current.previous === pendingRotation.previous ? { ...current, paths: [], reviewPaths: replacementPaths } : current)
        const status = await refreshRotationReadiness(pendingRotation)
        setRotationReady(status.applied)
        setNotice(status.applied
          ? (russian ? 'Сохранённая конфигурация с новой ссылкой подтверждена всеми готовыми репликами.' : 'The saved configuration with the new reference is acknowledged by every ready replica.')
          : (russian ? 'Новая ссылка уже сохранена в Project, но точный digest ещё не подтверждён всеми готовыми репликами.' : 'The new reference is already saved in the Project, but every ready replica has not acknowledged its exact digest.'))
      }
      setConfirmRotationApply(false)
      setRotationApplyIntent(null)
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось проверить план ротации.' : 'Could not review the secret rotation.'))
    } finally { setBusy(false) }
  }

  async function applyRotation() {
    if (!pendingRotation || pendingRotation.paths === null || pendingRotation.paths.length === 0 || !workspace?.project || !selectedService || busy) return
    if (!confirmRotationApply) { setConfirmRotationApply(true); return }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await replaceServiceSecretReferencesAndSave(
        controller, workspace.project.id, selectedService.id, pendingRotation.previous,
        pendingRotation.created.reference, pendingRotation.paths,
      )
      const savedRotation = { ...pendingRotation, paths: [], reviewPaths: pendingRotation.paths }
      setPendingRotation((current) => current && current.previous === pendingRotation.previous ? savedRotation : current)
      setRotationReady(false)
      await applySavedServiceSecretRotation(
        controller, workspace.project.id, workspace.project.rootPath, selectedService.id,
        savedRotation.previous, savedRotation.created.reference,
      )
      const status = await refreshRotationReadiness(pendingRotation)
      setRotationReady(status.applied)
      setNotice(status.applied
        ? (russian ? `Новая конфигурация подтверждена всеми ${String(status.replicaCount)} готовыми репликами; старую ссылку теперь можно отозвать.` : `All ${String(status.replicaCount)} ready replicas acknowledged the new configuration; the old reference can now be revoked.`)
        : (russian ? 'Новая ссылка сохранена в Project, но все реплики ещё не подтвердили точный digest и готовность. Старая ссылка остаётся активной; проверьте runtime и повторите проверку.' : 'The new reference is saved in the Project, but every replica has not acknowledged the exact digest and readiness. The old reference stays active; inspect runtime and check again.'))
      await reloadAfterMutation()
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось применить ротацию секрета.' : 'Could not apply the secret rotation.'))
    } finally { setBusy(false); setConfirmRotationApply(false) }
  }

  async function retrySavedRotationApply(retryFailed: boolean) {
    if (!pendingRotation || pendingRotation.paths === null || pendingRotation.paths.length > 0 || !workspace?.project || !selectedService || busy) return
    const intent = retryFailed ? 'retry-failed' : 'apply'
    if (rotationApplyIntent !== intent) {
      setRotationApplyIntent(intent)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await applySavedServiceSecretRotation(
        controller, workspace.project.id, workspace.project.rootPath, selectedService.id,
        pendingRotation.previous, pendingRotation.created.reference, retryFailed,
      )
      const status = await refreshRotationReadiness(pendingRotation)
      setRotationReady(status.applied)
      setNotice(status.applied
        ? (russian ? `Новая конфигурация подтверждена всеми ${String(status.replicaCount)} готовыми репликами; старую ссылку теперь можно отозвать.` : `All ${String(status.replicaCount)} ready replicas acknowledged the new configuration; the old reference can now be revoked.`)
        : (russian ? 'Применение не подтверждено всеми репликами. Кандидат и старая ссылка сохранены; проверьте runtime и повторите проверку.' : 'The apply is not acknowledged by every replica. The candidate and previous reference remain available; inspect runtime and retry the check.'))
      await reloadAfterMutation()
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось повторно применить конфигурацию Project.' : 'Could not retry applying the saved Project configuration.'))
    } finally { setBusy(false); setConfirmRotationApply(false); setRotationApplyIntent(null) }
  }

  async function recheckRotationReadiness() {
    if (!pendingRotation || pendingRotation.paths === null || pendingRotation.paths.length > 0 || busy) return
    setBusy(true)
    setError('')
    try {
      const status = await refreshRotationReadiness(pendingRotation)
      setRotationReady(status.applied)
      setNotice(status.applied
        ? (russian ? `Точный digest подтверждён всеми ${String(status.replicaCount)} готовыми репликами.` : `The exact digest is acknowledged by all ${String(status.replicaCount)} ready replicas.`)
        : (russian ? 'Подтверждения пока нет. Старая ссылка остаётся активной; повторите проверку после готовности runtime.' : 'No complete acknowledgement yet. The previous reference stays active; check again when the runtime is ready.'))
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось проверить готовность реплик.' : 'Could not check replica readiness.'))
    } finally { setBusy(false) }
  }

  async function revoke(reference: string) {
    if (!api.revokeLocalServiceSecret || !serviceID || busy) return
    if (confirmRevoke !== reference) { setConfirmRevoke(reference); return }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const staged = stagedRotations.find((rotation) => rotation.previousReference === reference)
      if (staged) {
        const created = items.find((item) => item.reference === staged.createdReference)
        if (!created || created.state !== 'active') throw new Error(russian ? 'Новая ссылка ротации недоступна. Старая ссылка сохранена; обновите каталог.' : 'The staged replacement is unavailable. The previous reference remains active; refresh the catalog.')
        const readiness = await refreshRotationReadiness({ previous: reference, created })
        if (!readiness.applied) throw new Error(russian ? 'Все реплики ещё не подтвердили точный digest новой конфигурации. Старая ссылка не отозвана.' : 'Every replica has not acknowledged the exact new configuration digest. The previous reference was not revoked.')
      }
      await api.revokeLocalServiceSecret(serviceID, reference, true)
      setConfirmRevoke('')
      setNotice(russian ? 'Ссылка отозвана после проверки конфигурации Project и подтверждения готовности всех реплик.' : 'Reference was revoked after checking the Project config and every replica’s readiness acknowledgement.')
      await reloadAfterMutation()
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось отозвать ссылку на секрет.' : 'Could not revoke the secret reference.'))
    } finally { setBusy(false) }
  }

  async function reloadAfterMutation() {
    if (!serviceID || !api.readLocalServiceSecretReferences) return
    const next = parseServiceSecretCatalogDetails(await api.readLocalServiceSecretReferences(serviceID), serviceID)
    setItems(next.items)
    setStagedRotations(next.pendingRotations)
    setPendingRegistrations(next.pendingRegistrations)
  }

  async function retryRegistration(reference: string) {
    if (!api.registerLocalServiceSecret || !serviceID || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.registerLocalServiceSecret(serviceID, reference, true)
      setNotice(russian ? 'Ссылка зарегистрирована в Core. Значение осталось в системном vault.' : 'The reference is registered in Core. Its value remains in the OS vault.')
      await reloadAfterMutation()
    } catch (reason: unknown) {
      setError(messageOf(reason, russian ? 'Не удалось повторить регистрацию секрета в Core.' : 'Could not retry secret registration with Core.'))
    } finally { setBusy(false) }
  }

  async function refreshRotationReadiness(rotation: { previous: string; created: ServiceSecretReference }): Promise<{ applied: boolean; replicaCount: number }> {
    if (!workspace?.project || !selectedService) throw new Error('Project service context is unavailable')
    const [snapshot, statusJSON] = await Promise.all([
      api.readProjectSettings(workspace.project.id, selectedService.id),
      api.readRuntimeServiceMetadata(workspace.project.id, selectedService.id, 'status'),
    ])
    const status = parseServiceRuntimeStatus(statusJSON, selectedService.id)
    let savedValues: unknown
    try { savedValues = JSON.parse(snapshot.valuesJson) as unknown } catch { throw new Error(russian ? 'Не удалось разобрать сохранённую конфигурацию Project.' : 'The saved Project configuration could not be parsed.') }
    if (serviceSecretReferencePaths(savedValues, rotation.created.reference).length === 0 || serviceSecretReferencePaths(savedValues, rotation.previous).length > 0) {
      return { applied: false, replicaCount: status?.replicas.length ?? 0 }
    }
    const applied = !!status && typeof snapshot.configurationDigest === 'string' && projectSettingsApplied(snapshot.configurationDigest, status.replicas)
    return { applied, replicaCount: status?.replicas.length ?? 0 }
  }

  function resumeRotation(rotation: PendingServiceSecretRotation) {
    const created = items.find((item) => item.reference === rotation.createdReference)
    if (!created || !selectedService || rotation.serviceId !== selectedService.id) {
      setError(russian ? 'Новая ссылка ротации отсутствует в каталоге. Обновите список и проверьте CLI/Core.' : 'The staged replacement is missing from the catalog. Refresh and check CLI/Core.')
      return
    }
    setPendingRotation({ previous: rotation.previousReference, created, paths: null, reviewPaths: [] })
    setRotationReady(false)
    setConfirmRotationApply(false)
    setRotationApplyIntent(null)
    setError('')
    setNotice('')
  }

  return <div className="settings-section service-secrets-settings">
    <div className="section-heading-row"><div><h3>{russian ? 'Секреты сервисов' : 'Service secrets'}</h3><p className="muted">{russian ? 'Значения хранятся в системном vault; Core и Project получают только ссылки и метаданные. Runtime получает временный read-only mount.' : 'Values live in the OS vault; Core and Projects receive references and metadata only. Runtime uses a temporary read-only mount.'}</p><p className="muted">{russian ? 'Ротация выполняется вручную: сначала получите новое значение у поставщика, затем примените новую ссылку. Автоматическое продление недоступно для локально введённых значений; срок действия показывается только если его сообщает источник.' : 'Rotation is manual: obtain the replacement value from its provider, then apply the new reference. Automatic rotation is unavailable for locally entered values; expiry is shown only when the source reports it.'}</p></div><button type="button" className="secondary-button compact" disabled={!serviceID || busy} onClick={() => void reload()}><RefreshCw size={14} />{russian ? 'Обновить' : 'Refresh'}</button></div>
    {!workspace?.project ? <p className="muted">{russian ? 'Откройте Project для управления секретами.' : 'Open a Project to manage secrets.'}</p> : services.length === 0 ? <p className="muted">{russian ? 'В Project пока нет сервисов.' : 'This Project has no services yet.'}</p> : <>
      <label className="service-secret-service">{russian ? 'Сервис' : 'Service'}<select value={serviceID} disabled={busy} onChange={(event) => { setServiceID(event.target.value) }}>{services.map((service) => <option value={service.id} key={service.id}>{service.name} · {service.id}</option>)}</select></label>
      {selectedService && purposes.length === 0 && !busy && !error && <p className="muted">{russian ? 'Сервис не объявил назначений секретов в manifest.' : 'The service has not declared any secret purposes in its manifest.'}</p>}
      {pendingRegistrations.length > 0 && <section className="service-secret-rotation-review" aria-labelledby="service-secret-registration-heading">
        <h4 id="service-secret-registration-heading">{russian ? 'Ожидает регистрации в Core' : 'Pending Core registration'}</h4>
        <p className="muted">{russian ? 'Локальное значение и opaque reference сохранены. Повторная попытка не создаёт новый секрет.' : 'The local value and opaque reference are preserved. Retrying does not create a new secret.'}</p>
        {pendingRegistrations.map((registration) => <div className="service-secret-row" key={registration.reference}>
          <span className="service-secret-detail"><strong>{registration.label}</strong><small>{registration.purpose} · {registration.reference}</small></span>
          {registration.state === 'conflict'
            ? <span className="service-secret-state revoked">{russian ? 'Конфликт метаданных' : 'Metadata conflict'}</span>
            : <button type="button" className="secondary-button compact" disabled={busy || !api.registerLocalServiceSecret} onClick={() => void retryRegistration(registration.reference)}>{busy ? (russian ? 'Повторяю…' : 'Retrying…') : (russian ? 'Повторить регистрацию' : 'Retry registration')}</button>}
        </div>)}
      </section>}
      {purposes.length > 0 && <form className="service-secret-create" onSubmit={(event) => { event.preventDefault(); void create() }}>
        {rotationReference && <p className="dialog-hint" role="status">{russian ? `Введите значение, заранее выпущенное у внешнего поставщика, для ссылки ${rotationReference}. Автоматическая ротация источника не выполняется; старая ссылка останется активной до применения и подтверждения новой конфигурации.` : `Enter the replacement value issued by the external provider for ${rotationReference}. The provider is not rotated automatically; the old reference stays active until the new configuration is applied and acknowledged.`}</p>}
        <label>{russian ? 'Назначение' : 'Purpose'}<select value={purpose} disabled={busy || !!rotationReference} onChange={(event) => { setPurpose(event.target.value); setConfirmCreate(false); setRotationReference('') }}>{purposes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>{russian ? 'Название' : 'Label'}<input value={label} maxLength={128} disabled={busy} onChange={(event) => { setLabel(event.target.value); setConfirmCreate(false) }} placeholder={russian ? 'Например, API production' : 'For example, API production'} /></label>
        <label>{russian ? 'Значение' : 'Value'}<input type="password" autoComplete="new-password" value={secret} disabled={busy} onChange={(event) => { setSecret(event.target.value); setConfirmCreate(false) }} maxLength={16 * 1024} /></label>
        {confirmCreate && <p className="dialog-hint" role="alert">{rotationReference
          ? (russian ? 'Подтвердите выпуск новой ссылки. Существующая конфигурация и старая ссылка не меняются.' : 'Confirm issuing a new reference. The active configuration and old reference will remain unchanged.')
          : (russian ? 'Подтвердите сохранение в локальном системном хранилище. Значение не попадёт в Project.' : 'Confirm saving this value to the local system vault. It will not be written to the Project.')}</p>}
        <div className="service-secret-rotation-actions">
          {rotationReference && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { setRotationReference(''); setConfirmCreate(false); setSecret('') }}>{russian ? 'Отмена' : 'Cancel'}</button>}
          <button type="submit" className="primary-button compact" disabled={busy || !purpose || !label.trim() || !secret}><KeyRound size={14} />{confirmCreate
            ? (rotationReference ? (russian ? 'Подтвердить ротацию' : 'Confirm rotation') : (russian ? 'Подтвердить сохранение' : 'Confirm save'))
            : (rotationReference ? (russian ? 'Ротировать' : 'Rotate') : (russian ? 'Сохранить секрет' : 'Save secret'))}</button>
        </div>
      </form>}
      {busy && <p className="muted" role="status">{russian ? 'Загрузка…' : 'Loading…'}</p>}
      {stagedRotations.length > 0 && <section className="service-secret-pending-rotations" aria-labelledby="service-secret-pending-heading">
        <h4 id="service-secret-pending-heading">{russian ? 'Незавершённая ротация' : 'Pending rotations'}</h4>
        {stagedRotations.map((rotation) => <div className="service-secret-row" key={rotation.createdReference}>
          <span className="service-secret-detail"><strong>{rotation.purpose}</strong><small>{rotation.previousReference} → {rotation.createdReference}</small></span>
          <span className="service-secret-state staged">{russian ? 'Ожидает завершения' : 'Staged'}</span>
          <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { resumeRotation(rotation) }}>{russian ? 'Продолжить' : 'Resume'}</button>
        </div>)}
      </section>}
      {pendingRotation && <section className="service-secret-rotation-review" aria-labelledby="service-secret-rotation-heading">
        <h4 id="service-secret-rotation-heading">{russian ? 'Ротация секрета' : 'Secret rotation'}</h4>
        <p className="muted">{russian ? `Старая ссылка: ${pendingRotation.previous}` : `Previous reference: ${pendingRotation.previous}`}</p>
        <p className="muted">{russian ? `Новая ссылка: ${pendingRotation.created.reference}` : `New reference: ${pendingRotation.created.reference}`}</p>
        {pendingRotation.paths === null
          ? <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void previewRotation()}>{russian ? 'Показать изменения' : 'Review changes'}</button>
          : <>
            {rotationReady
              ? <p className="report-exported" role="status">{russian ? 'Применение подтверждено всеми репликами.' : 'Every replica acknowledged the applied configuration.'}</p>
              : pendingRotation.paths.length === 0
                ? <>
                  <p className="muted">{russian ? 'Новая ссылка уже записана в Project. Старую ссылку пока не отзывайте.' : 'The replacement is already saved in the Project. Keep the previous reference active until readiness is confirmed.'}</p>
                  <p className="muted">{russian ? 'Изменения в сохранённой конфигурации:' : 'Changes in the saved configuration:'}</p>
                  <ul>{pendingRotation.reviewPaths.map((path) => <li key={JSON.stringify(path)}><code>{serviceSecretJSONPointer(path)}</code><small><code>{pendingRotation.previous}</code> → <code>{pendingRotation.created.reference}</code></small></li>)}</ul>
                  <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void recheckRotationReadiness()}>{russian ? 'Повторить проверку готовности' : 'Recheck readiness'}</button>
                </>
                : <>
                <p className="muted">{russian ? 'Будут заменены ссылки в сохранённой конфигурации Project:' : 'The following references will be replaced in the saved Project configuration:'}</p>
                <ul>{pendingRotation.reviewPaths.map((path) => <li key={JSON.stringify(path)}><code>{serviceSecretJSONPointer(path)}</code><small><code>{pendingRotation.previous}</code> → <code>{pendingRotation.created.reference}</code></small></li>)}</ul>
                {confirmRotationApply && <p className="dialog-hint" role="alert">{russian ? 'Подтвердите замену ссылок, сохранение конфигурации Project и применение через Core. При отказе старая активная конфигурация и старая ссылка останутся рабочими.' : 'Confirm replacing these references, saving the Project configuration and applying it through Core. If validation fails, the old active configuration and old reference remain available.'}</p>}
                <button type="button" className="primary-button compact" disabled={busy} onClick={() => void applyRotation()}>{confirmRotationApply ? (russian ? 'Подтвердить и применить' : 'Confirm and apply') : (russian ? 'Заменить и применить' : 'Replace and apply')}</button>
              </>}
            {pendingRotation.paths.length === 0 && pendingRotation.reviewPaths.length > 0 && !rotationReady && <>
              {applyRecoveryOperationId
                ? <>
                  <p className="muted" role="status">{russian ? `Сначала проверьте Core operation ${applyRecoveryOperationId}.` : `Reconcile Core operation ${applyRecoveryOperationId} before retrying.`}</p>
                  <button type="button" className="secondary-button compact" disabled={busy || cliStreamState !== 'idle'} onClick={() => void controller.reconcileApplyRecovery()}>{cliStreamState !== 'idle' ? (russian ? 'Проверяю…' : 'Checking…') : (russian ? 'Проверить операцию' : 'Reconcile operation')}</button>
                </>
                : <>
                  {rotationApplyIntent && <p className="dialog-hint" role="alert">{rotationApplyIntent === 'retry-failed'
                    ? (russian ? 'Подтвердите повтор неудавшейся Core operation. Старая ссылка останется активной до подтверждения новой конфигурации всеми репликами.' : 'Confirm retrying the failed Core operation. The previous reference remains active until every replica acknowledges the new configuration.')
                    : (russian ? 'Подтвердите применение сохранённой конфигурации через Core. Старая ссылка останется активной до подтверждения всех реплик.' : 'Confirm applying the saved Project configuration through Core. The previous reference remains active until every replica acknowledges it.')}</p>}
                  <button type="button" className="secondary-button compact" disabled={busy || cliStreamState !== 'idle'} onClick={() => void retrySavedRotationApply(false)}>{rotationApplyIntent === 'apply' ? (russian ? 'Подтвердить применение' : 'Confirm apply') : (russian ? 'Применить сохранённую конфигурацию' : 'Apply saved configuration')}</button>
                  {applyRecoveryStatus === 'confirmation-required' && <button type="button" className="secondary-button compact" disabled={busy || cliStreamState !== 'idle'} onClick={() => void retrySavedRotationApply(true)}>{rotationApplyIntent === 'retry-failed' ? (russian ? 'Подтвердить повтор' : 'Confirm retry') : (russian ? 'Повторить неудавшееся применение' : 'Retry failed apply')}</button>}
                </>}
            </>}
          </>}
      </section>}
      {!busy && items.length > 0 && <div className="service-secret-list">{items.map((item) => <div className="service-secret-row" key={item.reference}><span className="service-secret-icon"><KeyRound size={15} /></span><span className="service-secret-detail"><strong>{item.label}</strong><small>{item.purpose} · {item.reference} · {russian ? 'создан' : 'created'} {item.createdAt}</small></span><span className={`service-secret-state ${item.state}`}>{item.state === 'active' ? (russian ? 'Активен' : 'Active') : (russian ? 'Отозван' : 'Revoked')}</span>{item.state === 'active' && <>
        <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { setRotationReference(item.reference); setPurpose(item.purpose); setLabel(`${item.label} rotated`.slice(0, 128)); setSecret(''); setConfirmCreate(false); setNotice('') }}><RotateCw size={14} />{russian ? 'Ротировать' : 'Rotate'}</button>
        <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void revoke(item.reference)}>{confirmRevoke === item.reference ? (russian ? 'Подтвердить отзыв' : 'Confirm revoke') : <><Trash2 size={14} />{russian ? 'Отозвать' : 'Revoke'}</>}</button>
      </>}</div>)}</div>}
      {items.some((item) => item.state === 'active') && <p className="muted service-secret-rotation">{russian ? 'Ротация staged: выпустите ссылку, замените её в Project, сохраните и дождитесь ready + ACK всех реплик. Отзыв заблокирован, пока сохранённая конфигурация использует ссылку или runtime не подтвердил точный digest.' : 'Rotation is staged: issue a reference, replace it in Project, save and wait for every replica to be ready and acknowledge it. Revocation stays blocked while the saved config uses the reference or runtime has not acknowledged its exact digest.'}</p>}
      {notice && <p className="report-exported" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </>}
  </div>
}
