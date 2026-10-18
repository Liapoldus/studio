import type { Connection } from '@xyflow/react'
import type { ArtifactReference, RuntimeService, ServiceLinkInput, ProjectFile, RuntimeServiceInput, ServiceSettingsSchemaPreview, StudioAPI, ThemePreference } from '../api/types'
import { initialWorkspaceTabs, isSafeApplyOperationID, messageOf, restoreWorkspaceState, workspaceSnapshot, workspaceStateUpdate, workspaceStateWithApplyRecovery, type LayoutPoint, type Locale, type WorkspaceApplyRecoveryOperationId, type WorkspaceApplyRecoveryStatus } from '../models/studio'
import { parseCoreServiceReadiness, parseServiceRuntimeStatus } from '../models/runtime'
import { applyConfigurationArrayOperations, configurationArrayOperations } from '../models/configurationArray'
import { configurationApplyReviewDiff } from '../models/configurationApplyReview'
import { asConfigurationObject, configurationDraftKey, configurationSecretReferencePathEditable, isConfigurationPatchEmpty, mergeConfiguration, configurationValuesEqual, type ConfigurationObject } from '../models/configurationDraft'
import { configurationSchemaDifferencePaths, configurationSchemasMatch, matchServiceConfigurationUIField, parseCompatiblePeerService, parseServiceConfigurationUI } from '../models/serviceConfigurationUI'
import { serviceConfigurationProvenanceDifferences } from '../models/serviceConfigurationProvenance'
import { studioPluginBridgeFailureCode } from '../models/pluginSurface'
import { latestStudioPluginSurfaces, parseInstalledStudioPluginInspections, parseStudioPluginInspection, type StudioPluginPackageInfo } from '../models/studioPluginPackage'
import { assignSingleServiceEditorPages, parseServiceEditorButtons, type ServiceEditorButtonCandidate } from '../models/serviceEditorButtons'
import { parseDeclaredSecretPurposes, parseServiceSecretCatalog } from '../models/serviceSecrets'
import { useStudioStore, type StudioPluginSurface } from '../stores/studio'

export type StudioController = ReturnType<typeof createStudioController>

export function createStudioController(api: StudioAPI) {
  const store = () => useStudioStore.getState()
  let operationSerial = 0
  let runtimeStatusSerial = 0
  let persistenceQueue = Promise.resolve()
  let settingsPersistenceQueue = Promise.resolve()
  let settingsApplyQueue = Promise.resolve()
  const settingsDraftLoads = new Map<string, Promise<void>>()
  const configurationUILoads = new Map<string, Promise<void>>()
  const resourceCatalogLoads = new Map<string, Promise<{ items: Array<{ value: string; label: string }> }>>()
  const serviceSecretCatalogLoads = new Map<string, Promise<{ items: Array<{ reference: string; label: string; state: 'active' | 'revoked' }>; truncated: boolean }>>()
  const peerCatalogLoads = new Map<string, Promise<{ methods: Array<{ id: string; version: string }> }>>()
  const peerContractChecks = new Map<string, Promise<{ id: string; version: string; contractVersion: string }>>()
  const serviceResourceOperations = new Map<string, string>()
  let coreMetadataQueue: Promise<void> = Promise.resolve()
  const settingsPersistTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void }>()
  const settingsApplyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingSettingsAutoApplies = new Map<string, {
    generation: number
    projectId: string
    projectRoot: string
    serviceKeys: Set<string>
    promise: Promise<void>
  }>()
  const pausedSettingsApplyScopes = new Set<string>()
  function beginOperation(): number { const serial = ++operationSerial; store().setBusy(true); return serial }
  function isCurrent(serial: number): boolean { return serial === operationSerial }
  function fail(reason: unknown, fallback: string): void { store().setError(messageOf(reason, fallback)) }

  function queueSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = settingsApplyQueue.catch(() => undefined).then(operation)
    settingsApplyQueue = next.then(() => undefined, () => undefined)
    return next
  }

  function queueSettingsAutoApply(key: string): Promise<void> {
    const draft = store().serviceSettingsDrafts[key]
    if (!draft) return Promise.resolve()
    const scope = settingsApplyScope(draft.projectId, draft.projectRoot)
    const pending = pendingSettingsAutoApplies.get(scope)
    if (pending) {
      pending.serviceKeys.add(key)
      pending.generation += 1
      return pending.promise
    }

    const request = {
      generation: 0,
      projectId: draft.projectId,
      projectRoot: draft.projectRoot,
      serviceKeys: new Set([key]),
      promise: Promise.resolve(),
    }
    const queued = queueSettingsOperation(async () => {
      let appliedGeneration = -1
      while (appliedGeneration !== request.generation) {
        appliedGeneration = request.generation
        const activeProject = store().workspace?.project
        if (!activeProject || activeProject.id !== request.projectId || activeProject.rootPath !== request.projectRoot) break

        const serviceKeys = [...request.serviceKeys]
        request.serviceKeys.clear()
        const shouldApply = !pausedSettingsApplyScopes.has(scope) || !store().applyRecoveryOperationId
        let hasDirtyDraft = false
        let allDraftsSaved = true
        let allContractsMatched = true
        for (const serviceKey of serviceKeys) {
          const pendingDraft = store().serviceSettingsDrafts[serviceKey]
          if (!pendingDraft?.schema || pendingDraft.projectId !== request.projectId || pendingDraft.projectRoot !== request.projectRoot ||
              pendingDraft.status !== 'dirty' || isConfigurationPatchEmpty(pendingDraft.patch)) continue

          hasDirtyDraft = true
          if (pendingDraft.configurationContractState !== 'matched') allContractsMatched = false
          await saveServiceSettingsDraftNow(serviceKey, false)
          const savedDraft = store().serviceSettingsDrafts[serviceKey]
          if (savedDraft?.status !== 'clean' || !isConfigurationPatchEmpty(savedDraft.patch)) allDraftsSaved = false
        }

        const reviewPaths = store().applyReviewPaths
        if (hasDirtyDraft && allDraftsSaved && allContractsMatched && shouldApply && reviewPaths.length === 0) {
          await runDevApply(request.projectId, request.projectRoot, true)
        } else if (hasDirtyDraft && allDraftsSaved && allContractsMatched && reviewPaths.length > 0) {
          setPausedSettingsApplyScope(request.projectId, request.projectRoot, true)
          await persistApplyRecovery(request.projectId, request.projectRoot, 'confirmation-required', null, reviewPaths)
        }
      }
    })
    request.promise = queued.finally(() => {
      if (pendingSettingsAutoApplies.get(scope) === request) pendingSettingsAutoApplies.delete(scope)
    })
    pendingSettingsAutoApplies.set(scope, request)
    return request.promise
  }

  function queueCoreMetadataRead<T>(operation: () => Promise<T>): Promise<T> {
    const next = coreMetadataQueue.catch(() => undefined).then(operation)
    coreMetadataQueue = next.then(() => undefined, () => undefined)
    return next
  }

  async function refresh() {
    const serial = beginOperation(); store().setError(null)
    try {
      const [projects, workspace, preferences, toolchain] = await Promise.all([api.listProjects(), api.workspace(), api.clientPreferences(), api.toolchainStatus()])
      if (!isCurrent(serial)) return
      if (store().workspace?.project?.id !== workspace.project?.id) store().setRuntimeStatuses({})
      store().setProjects(projects); store().setWorkspace(workspace); store().setLocaleState(preferences.locale); store().setThemeState(preferences.theme); store().setToolchain(toolchain)
      if (!workspace.project) { store().setView('home'); store().setTabs(initialWorkspaceTabs(), 'canvas'); store().setStateHydrated(false); store().setApplyRecovery('none', null); return }
      const restored = await restoreWorkspaceState(api)
      if (!isCurrent(serial)) return
      store().setApplyRecovery(restored.applyRecoveryStatus, restored.applyRecoveryOperationId, restored.applyReviewPaths)
      setPausedSettingsApplyScope(workspace.project.id, workspace.project.rootPath, restored.applyRecoveryStatus !== 'none')
      store().setTabs(restored.tabs, restored.activeTabId); store().setLayout(restored.layout); store().setView('workspace'); store().setStateHydrated(restored.writable)
      if (!restored.writable) fail('Состояние workspace не поддерживается: автосохранение отключено. Восстановите исходный файл .studio/workspace.json.', '')
    } catch (reason: unknown) { if (isCurrent(serial)) fail(reason, 'Не удалось загрузить Studio') } finally { if (isCurrent(serial)) store().setBusy(false); store().setInitialized(true) }
  }

  async function refreshGraph() {
    await refresh()
    await refreshRuntimeStatuses()
  }

  async function refreshRuntimeStatuses() {
    const serial = ++runtimeStatusSerial
    const workspace = store().workspace
    if (!workspace?.project) { store().setRuntimeStatuses({}); store().setRuntimeReplicas({}); return }
    const projectID = workspace.project.id
    const projectRoot = workspace.project.rootPath
    const isCurrentProject = () => {
      const current = store().workspace?.project
      return serial === runtimeStatusSerial && current?.id === projectID && current.rootPath === projectRoot
    }
    const statuses: Record<string, NonNullable<ReturnType<typeof parseServiceRuntimeStatus>>['readiness'] | 'unknown'> = {}
    const replicas: Record<string, NonNullable<ReturnType<typeof parseServiceRuntimeStatus>>['replicas']> = {}
    const contractsToRevalidate: RuntimeService[] = []
    for (const service of workspace.graph.services) {
      if (!isCurrentProject()) return
      try {
        const status = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, service.id, 'status'))
        const parsed = parseServiceRuntimeStatus(status, service.id)
        statuses[service.id] = parsed?.readiness ?? parseCoreServiceReadiness(status, service.id)
        replicas[service.id] = parsed?.replicas ?? []
        if (parsed) {
          const key = configurationDraftKey(projectRoot, service.id)
          const draft = store().serviceSettingsDrafts[key]
          const contractState = draft?.configurationContractState
          if (draft?.schema && !draft.refreshingContract && draft.configurationContractMismatchKind !== 'schema' &&
              (contractState === 'matched' || contractState === 'mismatch' || contractState === 'unavailable')) {
            const artifact = service.artifact
            const artifactMatches = Boolean(artifact && artifact.id === service.id &&
              parsed.replicas.every((replica) => replica.artifactVersion === artifact.version && replica.artifactDigest === artifact.digest))
            if (!artifactMatches && (contractState === 'matched' || draft.configurationContractMismatchKind === 'provenance')) {
              // Pause edits/apply as soon as Core reports a release different
              // from the Project pin. Do not wait for the user to reopen the
              // inspector or initiate another runtime operation.
              store().setConfigurationContractState(key, 'mismatch', ['runtime.artifact'], 'provenance')
            } else if (artifactMatches && (contractState === 'unavailable' ||
                contractState === 'mismatch' && draft.configurationContractMismatchKind === 'provenance')) {
              contractsToRevalidate.push(service)
            }
          }
        }
      } catch { statuses[service.id] = 'unknown'; replicas[service.id] = [] }
      if (!isCurrentProject()) return
      store().setRuntimeStatuses({ ...statuses })
      store().setRuntimeReplicas({ ...replicas })
    }
    if (!isCurrentProject()) return
    for (const service of contractsToRevalidate) {
      if (!isCurrentProject()) return
      await refreshServiceSettingsContract(service)
    }
  }

  async function openProject(root: string) {
    if (!root) return
    const serial = beginOperation(); store().setError(null); store().setStateHydrated(false)
    try {
      const workspace = await api.openProject(root); const restored = await restoreWorkspaceState(api)
      if (!isCurrent(serial)) return
      if (workspace.project) {
        store().setApplyRecovery(restored.applyRecoveryStatus, restored.applyRecoveryOperationId, restored.applyReviewPaths)
        setPausedSettingsApplyScope(workspace.project.id, workspace.project.rootPath, restored.applyRecoveryStatus !== 'none')
      }
      store().setRuntimeStatuses({}); store().setWorkspace(workspace); store().setTabs(restored.tabs, restored.activeTabId); store().setLayout(restored.layout); store().setView('workspace'); store().setStateHydrated(restored.writable)
      if (!restored.writable) fail('Состояние workspace не поддерживается: автосохранение отключено. Восстановите исходный файл .studio/workspace.json.', '')
      const projects = await api.listProjects()
      if (isCurrent(serial)) store().setProjects(projects)
    } catch (reason: unknown) { if (isCurrent(serial)) fail(reason, `Не удалось открыть проект: ${root}`) } finally { if (isCurrent(serial)) store().setBusy(false) }
  }

  async function createProject() {
    const state = store(); if (!state.projectID.trim() || !state.projectName.trim()) return
    store().setError(null)
    let serial: number | null = null
    try {
      const parent = await api.selectProjectCreationDirectory(); if (!parent) return
      serial = beginOperation(); store().setCreateOpen(false)
      const workspace = await api.createProject(parent, state.projectID.trim(), state.projectName.trim())
      if (!isCurrent(serial)) return
      store().setRuntimeStatuses({}); store().setWorkspace(workspace); store().setApplyRecovery('none', null); store().setProjects(await api.listProjects()); store().setTabs(initialWorkspaceTabs(), 'canvas'); store().setLayout({}); store().setView('workspace'); store().setStateHydrated(true); store().setCreateOpen(false); store().setField('projectID', ''); store().setField('projectName', '')
    } catch (reason: unknown) { if (serial === null || isCurrent(serial)) fail(reason, 'Не удалось создать проект') } finally { if (serial !== null && isCurrent(serial)) store().setBusy(false) }
  }

  async function openFileExternally(file: ProjectFile) {
    try { await api.openFileExternally(file.path, ''); store().setError(null) }
    catch (reason: unknown) { fail(reason, `Не удалось открыть файл во внешнем редакторе: ${file.path}`) }
  }

  async function run(command: string, target = 'local') {
    store().navigate('output'); store().setError(null)
    try {
      const lifecycleCommand = command === 'runtime.start' || command === 'runtime.restart' || command === 'runtime.stop'
      const commandTarget = command === 'target.list' ? '' : target
      if (lifecycleCommand) await api.runStudioCommandAndWait(command, commandTarget)
      else await api.runStudioCommand(command, commandTarget)
      if (lifecycleCommand) {
        await refreshRuntimeStatuses()
        await refreshOpenServiceConfigurationContracts()
      }
    } catch (reason: unknown) { fail(reason, `Не удалось выполнить CLI-команду: ${command}`) }
  }
  async function cancelCLI(): Promise<void> { try { await api.cancelCLI() } catch (reason: unknown) { fail(reason, 'Не удалось остановить процесс CLI') } }

  async function loadServiceSettingsDraft(service: RuntimeService): Promise<string | null> {
    const project = store().workspace?.project
    if (!project?.rootPath || !project.id || !service.settingsPath || !service.settingsSchemaPath) return null
    const expectedKey = configurationDraftKey(project.rootPath, service.id)
    const inFlight = settingsDraftLoads.get(expectedKey)
    if (inFlight) {
      await inFlight
      return expectedKey
    }
    const { key, shouldLoad } = store().beginServiceSettingsDraft({ projectId: project.id, projectRoot: project.rootPath, serviceId: service.id, settingsPath: service.settingsPath, schemaPath: service.settingsSchemaPath })
    if (!shouldLoad) return key
    const loading = (async () => {
      try {
        const [schemaBytes, snapshot, persisted] = await Promise.all([api.readProjectSchema(project.id, service.id), api.readProjectSettings(project.id, service.id), api.readServiceSettingsDraft(project.id, service.id)])
        const schema = asConfigurationObject(JSON.parse(new TextDecoder().decode(schemaBytes)) as unknown)
        const base = asConfigurationObject(JSON.parse(snapshot.valuesJson) as unknown)
        const patch = persisted ? asConfigurationObject(JSON.parse(persisted.patchJson) as unknown) : {}
        if (!schema || !base || !patch || !snapshot.digest) throw new Error('Settings schema, redacted values, or digest are invalid')
        const conflict = Boolean(persisted && persisted.baseDigest !== snapshot.digest)
        store().hydrateServiceSettingsDraft(key, schema, base, snapshot.digest, patch, conflict, null, snapshot.configurationDigest)
        await loadServiceConfigurationUI(project.id, project.rootPath, service, key, schema)
      } catch (reason: unknown) {
        store().failServiceSettingsDraftLoad(key, messageOf(reason, 'Settings unavailable'))
      }
    })()
    settingsDraftLoads.set(key, loading)
    try { await loading } finally { if (settingsDraftLoads.get(key) === loading) settingsDraftLoads.delete(key) }
    return key
  }

  async function importServiceSettingsSchema(service: RuntimeService): Promise<void> {
    const project = store().workspace?.project
    if (!project?.id || !project.rootPath || !service.settingsSchemaPath) throw new Error('service.schema_import_unavailable')
    const key = configurationDraftKey(project.rootPath, service.id)
    const refreshed = await api.importServiceSettingsSchema(project.id, service.id)
    const currentProject = store().workspace?.project
    if (currentProject?.id !== project.id || currentProject.rootPath !== project.rootPath) return
    store().removeServiceSettingsDraft(key)
    store().setWorkspace(refreshed)
    await loadServiceSettingsDraft(service)
  }

  async function previewServiceSettingsSchema(service: RuntimeService): Promise<ServiceSettingsSchemaPreview> {
    const project = store().workspace?.project
    if (!project?.id || !project.rootPath || !service.settingsPath || !service.settingsSchemaPath) throw new Error('service.schema_preview_unavailable')
    const key = configurationDraftKey(project.rootPath, service.id)
    await loadServiceSettingsDraft(service)
    const initial = store().serviceSettingsDrafts[key]
    if (!initial?.schema || initial.configurationContractState !== 'mismatch') throw new Error('service.schema_preview_unavailable')
    // Revalidate status → manifest/schema → status before presenting a schema
    // update. A release/provenance mismatch must never be treated as migration.
    await loadServiceConfigurationUI(project.id, project.rootPath, service, key, initial.schema, true)
    if (store().serviceSettingsDrafts[key]?.configurationContractMismatchKind !== 'schema') throw new Error('service.schema_preview_unavailable')
    if (!store().beginServiceSettingsContractRefresh(key)) throw new Error('service.schema_preview_busy')
    try {
      await flushServiceSettingsDraft(key)
      const latest = store().serviceSettingsDrafts[key]
      if (!latest?.schema || latest.configurationContractMismatchKind !== 'schema') throw new Error('service.schema_preview_unavailable')
      const revision = latest.revision
      const patchJSON = JSON.stringify(latest.patch)
      const preview = await api.previewServiceSettingsSchema(project.id, service.id, patchJSON)
      const parsedSchema = asConfigurationObject(JSON.parse(preview.schemaJson) as unknown)
      const digest = /^sha256:[a-f0-9]{64}$/u
      if (!parsedSchema || preview.schemaJson.length > 1_048_576 || !digest.test(preview.schemaDigest) ||
          !digest.test(preview.previousSchemaDigest) || !digest.test(preview.settingsDigest) || !digest.test(preview.draftDigest) ||
          typeof preview.valuesCompatible !== 'boolean' || typeof preview.migrationRequired !== 'boolean' ||
          !Array.isArray(preview.migrationChangedPaths) || preview.migrationChangedPaths.length > 16 ||
          (preview.migrationRequired && (!digest.test(preview.migrationCandidateDigest) || !Number.isSafeInteger(preview.migrationFromVersion) || !Number.isSafeInteger(preview.migrationToVersion) || preview.migrationFromVersion <= 0 || preview.migrationToVersion <= 0 || preview.recoveryCopyPath.startsWith('/') || !preview.recoveryCopyPath.endsWith('.bak') || preview.recoveryCopyPath.split('/').includes('..') || preview.recoverySchemaCopyPath.startsWith('/') || !preview.recoverySchemaCopyPath.endsWith('.bak') || preview.recoverySchemaCopyPath.split('/').includes('..')))) {
        throw new Error('service.schema_preview_invalid')
      }
      const currentProject = store().workspace?.project
      const currentDraft = store().serviceSettingsDrafts[key]
      if (currentProject?.id !== project.id || currentProject.rootPath !== project.rootPath || currentDraft?.revision !== revision) {
        throw new Error('service.schema_preview_stale')
      }
      return preview
    } finally {
      store().endServiceSettingsContractRefresh(key)
    }
  }

  async function refreshServiceSettingsSchema(service: RuntimeService, preview: ServiceSettingsSchemaPreview): Promise<void> {
    const project = store().workspace?.project
    if (!project?.id || !project.rootPath || !service.settingsSchemaPath) throw new Error('service.schema_refresh_unavailable')
    const key = configurationDraftKey(project.rootPath, service.id)
    if (store().serviceSettingsDrafts[key]?.configurationContractMismatchKind !== 'schema') throw new Error('service.schema_refresh_unavailable')
    const hasDraft = Boolean(store().serviceSettingsDrafts[key])
    if (hasDraft && !store().beginServiceSettingsContractRefresh(key)) throw new Error('service.schema_refresh_busy')
    try {
      const applyTimer = settingsApplyTimers.get(key)
      if (applyTimer) clearTimeout(applyTimer)
      settingsApplyTimers.delete(key)
      await flushServiceSettingsDraft(key)
      const currentProject = store().workspace?.project
      if (currentProject?.id !== project.id || currentProject.rootPath !== project.rootPath) return
      const currentDraft = store().serviceSettingsDrafts[key]
      const patchJSON = JSON.stringify(currentDraft?.patch ?? {})
      const refreshed = await api.refreshServiceSettingsSchema(project.id, service.id, preview, patchJSON)
      const refreshedProject = store().workspace?.project
      if (refreshedProject?.id !== project.id || refreshedProject.rootPath !== project.rootPath) return
      store().removeServiceSettingsDraft(key)
      store().setWorkspace(refreshed)
      await loadServiceSettingsDraft(service)
    } finally {
      if (hasDraft) store().endServiceSettingsContractRefresh(key)
    }
  }

  async function refreshServiceSettingsContract(service: RuntimeService): Promise<void> {
    const project = store().workspace?.project
    if (!project?.id || !project.rootPath || !service.settingsPath || !service.settingsSchemaPath) return
    const key = configurationDraftKey(project.rootPath, service.id)
    const draft = store().serviceSettingsDrafts[key]
    if (!draft) return loadServiceSettingsDraft(service).then(() => undefined)
    if (!store().beginServiceSettingsContractRefresh(key)) return
    try {
      const applyTimer = settingsApplyTimers.get(key)
      if (applyTimer) clearTimeout(applyTimer)
      settingsApplyTimers.delete(key)
      await flushServiceSettingsDraft(key)
      const latest = store().serviceSettingsDrafts[key]
      if (!latest) return
      const currentProject = store().workspace?.project
      if (currentProject?.id !== project.id || currentProject.rootPath !== project.rootPath) return
      const pendingMetadata = configurationUILoads.get(key)
      if (pendingMetadata) await pendingMetadata
      store().removeServiceSettingsDraft(key)
      await loadServiceSettingsDraft(service)
    } catch (reason: unknown) {
      store().setServiceSettingsDraftError(key, messageOf(reason, 'Could not refresh the live service contract'))
    } finally {
      store().endServiceSettingsContractRefresh(key)
    }
  }

  function loadServiceConfigurationUI(projectID: string, projectRoot: string, service: RuntimeService, key: string, schema: ConfigurationObject, forceRefresh = false): Promise<void> {
    const serviceID = service.id
    const inFlight = configurationUILoads.get(key)
    if (inFlight) {
      if (!forceRefresh) return inFlight
      return inFlight.then(() => {
        if (configurationUILoads.get(key) === inFlight) configurationUILoads.delete(key)
        return loadServiceConfigurationUI(projectID, projectRoot, service, key, schema)
      })
    }
    const loading = (async () => {
      try {
        // The native CLI runner intentionally permits only one child process
        // at a time, so these Core-backed reads must be serialized.
        const statusBefore = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, serviceID, 'status'))
        const manifest = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, serviceID, 'manifest'))
        const liveSchema = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, serviceID, 'schema'))
        const statusAfter = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, serviceID, 'status'))
        const currentProject = store().workspace?.project
        if (currentProject?.id !== projectID || currentProject.rootPath !== projectRoot) return
        const currentService = store().workspace?.graph.services.find((candidate) => candidate.id === serviceID)
        if (!currentService || currentService.artifact?.digest !== service.artifact?.digest ||
            currentService.artifact?.version !== service.artifact?.version || currentService.artifact?.platform !== service.artifact?.platform) return
        const provenanceDifferences = serviceConfigurationProvenanceDifferences(service, manifest, statusBefore, statusAfter)
        if (provenanceDifferences.length > 0) {
          store().setConfigurationContractState(key, 'mismatch', provenanceDifferences, 'provenance')
          return
        }
        if (!configurationSchemasMatch(schema, liveSchema)) {
          store().setConfigurationContractState(key, 'mismatch', configurationSchemaDifferencePaths(schema, liveSchema), 'schema')
          return
        }
        store().setConfigurationContractState(key, 'matched')
        store().setServiceConfigurationUI(key, parseServiceConfigurationUI(manifest, schema))
      } catch {
        // Offline Project drafts remain editable, but no live descriptor is
        // trusted and no Core apply is allowed until the contract is rechecked.
        const currentProject = store().workspace?.project
        if (currentProject?.id === projectID && currentProject.rootPath === projectRoot) {
          store().setConfigurationContractState(key, 'unavailable')
        }
      }
    })()
    configurationUILoads.set(key, loading)
    void loading.then(() => { if (configurationUILoads.get(key) === loading) configurationUILoads.delete(key) })
    return loading
  }

  async function refreshOpenServiceConfigurationContracts(projectID?: string, projectRoot?: string): Promise<void> {
    const workspace = store().workspace
    const project = workspace?.project
    if (!workspace || !project || (projectID && project.id !== projectID) || (projectRoot && project.rootPath !== projectRoot)) return
    const loadedDrafts = Object.values(store().serviceSettingsDrafts).filter((draft) =>
      draft?.schema && draft.projectId === project.id && draft.projectRoot === project.rootPath,
    )
    for (const maybeDraft of loadedDrafts) {
      if (!maybeDraft?.schema) continue
      const draft = maybeDraft
      const service = workspace.graph.services.find((candidate) => candidate.id === draft.serviceId)
      if (!service) throw new Error(`Configured service ${draft.serviceId} is no longer present in the Project graph`)
      await loadServiceConfigurationUI(project.id, project.rootPath, service, draft.key, draft.schema as ConfigurationObject, true)
      if (store().serviceSettingsDrafts[draft.key]?.configurationContractState !== 'matched') {
        throw new Error(`Live contract or artifact provenance for service ${service.id} must be reviewed before Core apply`)
      }
    }
  }

  function pluginServiceContext(projectID: string, serviceID: string): { key: string; service: RuntimeService } {
    const workspace = store().workspace
    if (!workspace?.project || workspace.project.id !== projectID) throw new Error('bridge.context_changed')
    const service = workspace.graph.services.find((candidate) => candidate.id === serviceID)
    if (!service?.settingsPath || !service.settingsSchemaPath) throw new Error('bridge.service_unavailable')
    return { key: configurationDraftKey(workspace.project.rootPath, service.id), service }
  }

  function pluginContextIsCurrent(projectID: string, serviceID: string, expectedKey: string): boolean {
    try { return pluginServiceContext(projectID, serviceID).key === expectedKey }
    catch { return false }
  }

  function assertPluginContext(projectID: string, serviceID: string, expectedKey: string): void {
    if (!pluginContextIsCurrent(projectID, serviceID, expectedKey)) throw new Error('bridge.context_changed')
  }

  async function pluginCreateServiceSettingsRecoveryCopy(projectID: string, serviceID: string, expectedDigest: string) {
    const { key, service } = pluginServiceContext(projectID, serviceID)
    if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDigest)) throw new Error('bridge.recovery_digest_invalid')
    await loadServiceSettingsDraft(service)
    assertPluginContext(projectID, serviceID, key)
    if (store().serviceSettingsDrafts[key]?.baseDigest !== expectedDigest) throw new Error('bridge.recovery_source_changed')
    const copy = await api.createServiceSettingsRecoveryCopy(projectID, serviceID, expectedDigest)
    assertPluginContext(projectID, serviceID, key)
    if (copy.digest !== expectedDigest || typeof copy.path !== 'string' || copy.path.length === 0 || copy.path.length > 512 ||
        copy.path.startsWith('/') || copy.path.includes('\\') || /[\0\r\n]/u.test(copy.path) || !copy.path.endsWith('.bak') ||
        copy.path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('bridge.recovery_response_invalid')
    }
    return { path: copy.path, digest: copy.digest }
  }

  function pluginSettingsSnapshot(key: string) {
    const draft = store().serviceSettingsDrafts[key]
    if (!draft?.schema) throw new Error('bridge.settings_unavailable')
    return {
      serviceId: draft.serviceId,
      schema: draft.schema,
      values: mergeConfiguration(draft.base, draft.patch),
      patch: draft.patch,
      baseDigest: draft.baseDigest,
      status: draft.status,
      configurationUI: draft.configurationUI,
      errorCode: draft.status === 'conflict' ? 'settings_conflict' : draft.status === 'error' ? 'settings_operation_failed' : '',
    }
  }

  async function pluginReadServiceSettings(projectID: string, serviceID: string) {
    const { key, service } = pluginServiceContext(projectID, serviceID)
    await loadServiceSettingsDraft(service)
    return pluginSettingsSnapshot(key)
  }

  async function pluginReadServiceConfigurationUI(projectID: string, serviceID: string) {
    const { key, service } = pluginServiceContext(projectID, serviceID)
    await loadServiceSettingsDraft(service)
    const schema = store().serviceSettingsDrafts[key]?.schema
    if (!schema) throw new Error('bridge.settings_unavailable')
    const current = pluginServiceContext(projectID, serviceID)
    if (current.key !== key) throw new Error('bridge.context_changed')
    if (store().serviceSettingsDrafts[key]?.configurationContractState !== 'matched') throw new Error('bridge.schema_unverified')
    return store().serviceSettingsDrafts[key]?.configurationUI ?? null
  }

  async function readServiceResourceCatalog(projectID: string, serviceID: string, resourceID: string) {
    const { key } = pluginServiceContext(projectID, serviceID)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(resourceID)) throw new Error('bridge.invalid_resource')
    const requestKey = `${key}\0${resourceID}`
    const existing = resourceCatalogLoads.get(requestKey)
    if (existing) return existing
    const request = (async () => {
      const encoded = await queueCoreMetadataRead(() => {
        if (!api.readRuntimeServiceResource) throw new Error('bridge.resource_api_unavailable')
        return api.readRuntimeServiceResource(projectID, serviceID, resourceID)
      })
      let parsed: unknown
      try { parsed = JSON.parse(encoded) as unknown } catch { throw new Error('bridge.resource_response_invalid') }
      if (!isRecord(parsed) || !Array.isArray(parsed.items) || parsed.items.length > 50) throw new Error('bridge.resource_response_invalid')
      const items: Array<{ value: string; label: string }> = []
      for (const item of parsed.items) {
        if (!isRecord(item) || typeof item.value !== 'string' || typeof item.label !== 'string' ||
            !safeResourceText(item.value) || !safeResourceText(item.label)) throw new Error('bridge.resource_response_invalid')
        items.push({ value: item.value, label: item.label })
      }
      const current = pluginServiceContext(projectID, serviceID)
      if (current.key !== key) throw new Error('bridge.context_changed')
      return { items }
    })()
    resourceCatalogLoads.set(requestKey, request)
    try { return await request }
    finally { if (resourceCatalogLoads.get(requestKey) === request) resourceCatalogLoads.delete(requestKey) }
  }

  async function pluginReadServiceResource(projectID: string, serviceID: string, resourceID: string) {
    return readServiceResourceCatalog(projectID, serviceID, resourceID)
  }

  async function pluginReadServiceSecretReferences(projectID: string, serviceID: string, purpose: string) {
    const { key } = pluginServiceContext(projectID, serviceID)
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u.test(purpose) || purpose.length > 192 || !api.readLocalServiceSecretReferences) {
      throw new Error('bridge.secret_catalog_unavailable')
    }
    const requestKey = `${key}\0${purpose}`
    const existing = serviceSecretCatalogLoads.get(requestKey)
    if (existing) return existing
    const request = (async () => {
      const manifestJSON = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, serviceID, 'manifest'))
      const declaredPurposes = parseDeclaredSecretPurposes(manifestJSON, serviceID)
      if (!declaredPurposes.includes(purpose)) throw new Error('bridge.secret_purpose_not_declared')
      if (pluginServiceContext(projectID, serviceID).key !== key) throw new Error('bridge.context_changed')
      const rawCatalog = await api.readLocalServiceSecretReferences?.(serviceID)
      if (typeof rawCatalog !== 'string') throw new Error('bridge.secret_catalog_unavailable')
      const catalog = parseServiceSecretCatalog(rawCatalog, serviceID)
      const allItems = catalog.filter((item) => item.purpose === purpose && item.state === 'active')
      const current = pluginServiceContext(projectID, serviceID)
      if (current.key !== key) throw new Error('bridge.context_changed')
      return { items: allItems.slice(0, 512).map(({ reference, label, state }) => ({ reference, label, state })), truncated: allItems.length > 512 }
    })()
    serviceSecretCatalogLoads.set(requestKey, request)
    try { return await request }
    finally { if (serviceSecretCatalogLoads.get(requestKey) === request) serviceSecretCatalogLoads.delete(requestKey) }
  }

  async function pluginSelectServiceSecretReference(projectID: string, serviceID: string, path: string[], purpose: string, reference: string) {
    const { key, service } = pluginServiceContext(projectID, serviceID)
    await loadServiceSettingsDraft(service)
    assertPluginContext(projectID, serviceID, key)
    requireMatchedConfigurationContract(key)
    if (!Array.isArray(path) || path.length === 0 || path.length > 64 ||
        path.some((segment) => typeof segment !== 'string' || !segment || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
      throw new Error('bridge.secret_path_invalid')
    }
    const draft = store().serviceSettingsDrafts[key]
    const field = matchServiceConfigurationUIField(draft?.configurationUI, path)
    if (!field || field.widget !== 'secret' || field.secretPurpose !== purpose ||
        !draft?.schema || !configurationSecretReferencePathEditable(draft.schema, path, purpose, reference)) {
      throw new Error('bridge.secret_path_not_declared')
    }
    const catalog = await pluginReadServiceSecretReferences(projectID, serviceID, purpose)
    if (!catalog.items.some((item) => item.reference === reference && item.state === 'active')) {
      throw new Error('bridge.secret_reference_unavailable')
    }
    assertPluginContext(projectID, serviceID, key)
    store().updateServiceSettingsSecretReference(key, path, purpose, reference)
    await persistServiceSettingsDraft(key, () => pluginContextIsCurrent(projectID, serviceID, key), false)
    assertPluginContext(projectID, serviceID, key)
    return pluginSettingsSnapshot(key)
  }

  async function pluginReadServiceAdminSurface(projectID: string, serviceID: string) {
    const { key } = pluginServiceContext(projectID, serviceID)
    if (!api.readRuntimeServiceAdminSurface) throw new Error('bridge.admin_surface_api_unavailable')
    const encoded = await queueCoreMetadataRead(() => api.readRuntimeServiceAdminSurface?.(projectID, serviceID) ?? Promise.reject(new Error('bridge.admin_surface_api_unavailable')))
    if (encoded.length > 1_048_576) throw new Error('bridge.admin_surface_response_invalid')
    let parsed: unknown
    try { parsed = JSON.parse(encoded) as unknown } catch { throw new Error('bridge.admin_surface_response_invalid') }
    if (!isRecord(parsed) || parsed.serviceId !== serviceID || !isRecord(parsed.descriptor)) {
      throw new Error('bridge.admin_surface_response_invalid')
    }
    if (typeof parsed.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(parsed.digest)) {
      throw new Error('bridge.admin_surface_digest_invalid')
    }
    if (pluginServiceContext(projectID, serviceID).key !== key) throw new Error('bridge.context_changed')
    return parsed
  }

  async function pluginReadServiceAdminTable(projectID: string, serviceID: string, pageID: string, sectionID: string, surfaceDigest: string, cursor = '') {
    const { key } = pluginServiceContext(projectID, serviceID)
    if (!api.readRuntimeServiceAdminTable) throw new Error('bridge.admin_table_api_unavailable')
    if (!/^sha256:[a-f0-9]{64}$/u.test(surfaceDigest)) throw new Error('bridge.admin_surface_digest_invalid')
    const encoded = await queueCoreMetadataRead(() => api.readRuntimeServiceAdminTable?.(projectID, serviceID, pageID, sectionID, surfaceDigest, cursor) ?? Promise.reject(new Error('bridge.admin_table_api_unavailable')))
    if (encoded.length > 1_048_576) throw new Error('bridge.admin_table_response_invalid')
    let parsed: unknown
    try { parsed = JSON.parse(encoded) as unknown } catch { throw new Error('bridge.admin_table_response_invalid') }
    if (!isRecord(parsed) || !Array.isArray(parsed.items) || parsed.items.length > 100 ||
        (parsed.nextCursor !== null && parsed.nextCursor !== undefined && (typeof parsed.nextCursor !== 'string' || parsed.nextCursor.length > 1024))) {
      throw new Error('bridge.admin_table_response_invalid')
    }
    if (pluginServiceContext(projectID, serviceID).key !== key) throw new Error('bridge.context_changed')
    return { items: parsed.items, nextCursor: parsed.nextCursor ?? null }
  }

  async function pluginInvokeServiceAdminAction(projectID: string, serviceID: string, payload: { pageId: string; sectionId: string; actionId: string; input: Record<string, unknown>; surfaceDigest: string; ifMatch?: string }) {
    const { key } = pluginServiceContext(projectID, serviceID)
    if (!api.invokeRuntimeServiceAdminAction) throw new Error('bridge.admin_action_api_unavailable')
    let encoded: string
    try {
      if (!isRecord(payload.input) || !isSafeServiceAdminActionInput(payload.input)) throw new Error('bridge.admin_action_input_invalid')
      encoded = JSON.stringify(payload.input)
      if (encoded.length > 65_536) throw new Error('bridge.admin_action_input_invalid')
    } catch {
      throw new Error('bridge.admin_action_input_invalid')
    }
    const result = await api.invokeRuntimeServiceAdminAction(projectID, serviceID, payload.pageId, payload.sectionId, payload.actionId, encoded, payload.ifMatch ?? '', payload.surfaceDigest)
    if (result.length > 4096) throw new Error('bridge.admin_action_response_invalid')
    let parsed: unknown
    try { parsed = JSON.parse(result) as unknown } catch { throw new Error('bridge.admin_action_response_invalid') }
    if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || parsed.completed !== true) throw new Error('bridge.admin_action_response_invalid')
    if (pluginServiceContext(projectID, serviceID).key !== key) throw new Error('bridge.context_changed')
    return { completed: true as const }
  }

  async function pluginSelectServiceResourceArtifact(projectID: string, serviceID: string, source: 'archive' | 'project-directory' = 'archive') {
    pluginServiceContext(projectID, serviceID)
    let selected: string | null
    if (source === 'project-directory') {
      if (!api.selectRuntimeServiceProjectDirectory) throw new Error('bridge.resource_publish_unavailable')
      selected = await api.selectRuntimeServiceProjectDirectory(projectID, serviceID)
    } else {
      if (!api.selectRuntimeServiceResourceArtifact) throw new Error('bridge.resource_publish_unavailable')
      selected = await api.selectRuntimeServiceResourceArtifact(projectID, serviceID)
    }
    if (!selected) return null
    const refreshedWorkspace = await api.workspace()
    if (refreshedWorkspace.project?.id !== projectID) throw new Error('bridge.context_changed')
    store().setWorkspace(refreshedWorkspace)
    if (selected.length > 512 || selected.startsWith('/') || selected.includes('\\') || selected.split('/').some((part) => !part || part.startsWith('.') || part === '..') ||
        !store().workspace?.files.some((file) => file.path === selected && file.kind === 'file')) throw new Error('bridge.invalid_resource_artifact')
    pluginServiceContext(projectID, serviceID)
    return { path: selected }
  }

  async function importProjectCertificateResource(projectID: string, serviceID: string, resourceID: string) {
    const { key } = pluginServiceContext(projectID, serviceID)
    if (!api.importRuntimeServiceProjectCertificate) throw new Error('bridge.resource_import_unavailable')
    const selected = await api.importRuntimeServiceProjectCertificate(projectID, serviceID, resourceID)
    if (!selected) return null
    const refreshedWorkspace = await api.workspace()
    if (refreshedWorkspace.project?.id !== projectID || pluginServiceContext(projectID, serviceID).key !== key) throw new Error('bridge.context_changed')
    store().setWorkspace(refreshedWorkspace)
    if (selected.length > 512 || selected.startsWith('/') || selected.includes('\\') || selected.split('/').some((part) => !part || part.startsWith('.') || part === '..') ||
        !refreshedWorkspace.files.some((file) => file.path === selected && file.kind === 'file')) throw new Error('bridge.invalid_resource_import')
    return selected
  }

  async function pluginPublishServiceResource(projectID: string, serviceID: string, payload: { pageId: string; actionId: string; artifactPath: string; contentType: string; metadata: Record<string, unknown>; ifMatch?: string }) {
    pluginServiceContext(projectID, serviceID)
    if (!api.publishRuntimeServiceResourceJSON) throw new Error('bridge.resource_publish_unavailable')
    const encoded = JSON.stringify(payload.metadata)
    if (encoded.length > 65_536) throw new Error('bridge.invalid_resource_metadata')
    const result = await api.publishRuntimeServiceResourceJSON(projectID, serviceID, payload.pageId, payload.actionId, payload.artifactPath, payload.contentType, encoded, payload.ifMatch ?? '')
    if (result.length > 1_048_576) throw new Error('bridge.resource_publish_response_invalid')
    let parsed: unknown
    try { parsed = JSON.parse(result) as unknown } catch { throw new Error('bridge.resource_publish_response_invalid') }
    if (!isRecord(parsed) || !isSafeApplyOperationID(parsed.operationId) || parsed.state !== 'pending') {
      throw new Error('bridge.resource_publish_response_invalid')
    }
    pluginServiceContext(projectID, serviceID)
    const contextKey = `${projectID}\u0000${pluginServiceContext(projectID, serviceID).key}`
    serviceResourceOperations.set(parsed.operationId, contextKey)
    while (serviceResourceOperations.size > 128) {
      const oldest = serviceResourceOperations.keys().next().value
      if (typeof oldest !== 'string') break
      serviceResourceOperations.delete(oldest)
    }
    return { operationId: parsed.operationId, state: 'pending' as const }
  }

  async function pluginWatchServiceResourceOperation(projectID: string, serviceID: string, operationID: string) {
    const { key } = pluginServiceContext(projectID, serviceID)
    const contextKey = `${projectID}\u0000${key}`
    if (!isSafeApplyOperationID(operationID) || serviceResourceOperations.get(operationID) !== contextKey) {
      throw new Error('bridge.operation_scope_invalid')
    }
    let terminalState = ''
    let failureCode = ''
    const unsubscribe = api.onCLIEvent((event) => {
      if (event.type === 'operation.updated' && event.target === 'local' && event.operationId === operationID &&
          ['succeeded', 'completed', 'failed', 'degraded', 'cancelled'].includes(event.state ?? '')) {
        terminalState = event.state ?? ''
        failureCode = typeof event.code === 'string' && /^[a-z0-9_]{1,64}$/u.test(event.code) ? event.code : ''
      }
    })
    try {
      await api.runStudioCommandAndWait('operation.watch', 'local', operationID)
    } catch (error: unknown) {
      throw new Error(studioPluginBridgeFailureCode(error, 'bridge.operation_watch_failed'))
    } finally {
      unsubscribe()
    }
    if (pluginServiceContext(projectID, serviceID).key !== key) throw new Error('bridge.context_changed')
    if (!terminalState) throw new Error('bridge.operation_state_unavailable')
    serviceResourceOperations.delete(operationID)
    return { operationId: operationID, state: terminalState, ...(failureCode ? { failureCode } : {}) }
  }

  async function pluginReadServicePeerCatalog(projectID: string, callerServiceID: string, targetServiceID?: string) {
    const { key } = pluginServiceContext(projectID, callerServiceID)
    const workspace = store().workspace
    if (!workspace?.project) throw new Error('bridge.context_changed')
    if (targetServiceID === undefined) {
      const services = workspace.graph.services.slice(0, 128).flatMap((candidate) => {
        if (!safePeerIdentifier(candidate.id)) return []
        const name = safePeerText(candidate.name) ? candidate.name : candidate.id
        const version = safePeerText(candidate.version) ? candidate.version : ''
        return [{ id: candidate.id, name, version }]
      })
      const current = pluginServiceContext(projectID, callerServiceID)
      if (current.key !== key) throw new Error('bridge.context_changed')
      return { services, truncated: workspace.graph.services.length > 128 }
    }
    if (!safePeerIdentifier(targetServiceID) || !workspace.graph.services.some((candidate) => candidate.id === targetServiceID)) {
      throw new Error('bridge.peer_target_unavailable')
    }
    const requestKey = `${key}\0${targetServiceID}`
    const existing = peerCatalogLoads.get(requestKey)
    if (existing) return existing
    const request = queueCoreMetadataRead(async () => {
      pluginServiceContext(projectID, callerServiceID)
      const currentWorkspace = store().workspace
      if (currentWorkspace?.project?.id !== projectID || !currentWorkspace.graph.services.some((candidate) => candidate.id === targetServiceID)) {
        throw new Error('bridge.context_changed')
      }
      let encoded: string
      try { encoded = await api.readRuntimeServiceMetadata(projectID, targetServiceID, 'manifest') }
      catch { throw new Error('bridge.peer_catalog_unavailable') }
      if (encoded.length > 1_048_576) throw new Error('bridge.peer_response_invalid')
      let parsed: unknown
      try { parsed = JSON.parse(encoded) as unknown } catch { throw new Error('bridge.peer_response_invalid') }
      const peerContracts = isRecord(parsed) && parsed.peerContracts === undefined ? [] : isRecord(parsed) ? parsed.peerContracts : null
      if (!Array.isArray(peerContracts) || peerContracts.length > 256) {
        throw new Error('bridge.peer_response_invalid')
      }
      const methods: Array<{ id: string; version: string }> = []
      const seenContracts = new Set<string>()
      const seenMethods = new Map<string, string>()
      let totalMethods = 0
      for (const contract of peerContracts) {
        if (!isRecord(contract) || typeof contract.id !== 'string' || !safePeerIdentifier(contract.id) ||
            typeof contract.version !== 'string' || !safePeerText(contract.version) || seenContracts.has(contract.id) ||
            !Array.isArray(contract.methods) || contract.methods.length > 256) {
          throw new Error('bridge.peer_response_invalid')
        }
        seenContracts.add(contract.id)
        totalMethods += contract.methods.length
        if (totalMethods > 1024) throw new Error('bridge.peer_response_invalid')
        for (const method of contract.methods) {
          if (typeof method !== 'string' || !safePeerIdentifier(method)) throw new Error('bridge.peer_response_invalid')
          const previousVersion = seenMethods.get(method)
          if (previousVersion !== undefined) {
            if (previousVersion !== contract.version) throw new Error('bridge.peer_response_invalid')
            continue
          }
          seenMethods.set(method, contract.version)
          methods.push({ id: method, version: contract.version })
        }
      }
      const current = pluginServiceContext(projectID, callerServiceID)
      const afterRead = store().workspace
      if (current.key !== key || afterRead?.project?.id !== projectID || !afterRead.graph.services.some((candidate) => candidate.id === targetServiceID)) {
        throw new Error('bridge.context_changed')
      }
      return { methods }
    })
    peerCatalogLoads.set(requestKey, request)
    try { return await request }
    finally { if (peerCatalogLoads.get(requestKey) === request) peerCatalogLoads.delete(requestKey) }
  }

  async function verifyServicePeerContract(projectID: string, callerServiceID: string, targetServiceID: string, contractID: string) {
    const before = store().workspace
    const projectRoot = before?.project?.rootPath
    if (!safePeerIdentifier(projectID) || !safePeerIdentifier(callerServiceID) || !safePeerIdentifier(targetServiceID) ||
        !safePeerIdentifier(contractID) || callerServiceID === targetServiceID || before?.project?.id !== projectID || !projectRoot ||
        !before.graph.services.some((candidate) => candidate.id === callerServiceID) ||
        !before.graph.services.some((candidate) => candidate.id === targetServiceID)) {
      throw new Error('peer.target_unavailable')
    }
    const requestKey = `${projectID}\0${projectRoot}\0${targetServiceID}\0${contractID}`
    const existing = peerContractChecks.get(requestKey)
    const request = existing ?? queueCoreMetadataRead(async () => {
      const targetService = before.graph.services.find((candidate) => candidate.id === targetServiceID)
      if (!targetService) throw new Error('peer.target_unavailable')
      let statusBefore: string
      let manifest: string
      let statusAfter: string
      try {
        statusBefore = await api.readRuntimeServiceMetadata(projectID, targetServiceID, 'status')
        manifest = await api.readRuntimeServiceMetadata(projectID, targetServiceID, 'manifest')
        statusAfter = await api.readRuntimeServiceMetadata(projectID, targetServiceID, 'status')
      }
      catch { throw new Error('peer.metadata_unavailable') }
      const current = store().workspace
      const currentTarget = current?.graph.services.find((candidate) => candidate.id === targetServiceID)
      if (current?.project?.id !== projectID || current.project.rootPath !== projectRoot ||
          !current.graph.services.some((candidate) => candidate.id === callerServiceID) || !currentTarget) {
        throw new Error('peer.context_changed')
      }
      const provenanceDifferences = serviceConfigurationProvenanceDifferences(targetService, manifest, statusBefore, statusAfter)
      const currentProvenanceDifferences = serviceConfigurationProvenanceDifferences(currentTarget, manifest, statusBefore, statusAfter)
      if (provenanceDifferences.length > 0 || currentProvenanceDifferences.length > 0) throw new Error('peer.provenance_mismatch')
      const compatible = parseCompatiblePeerService(manifest, targetServiceID, contractID)
      if (!compatible) throw new Error('peer.contract_not_advertised')
      return compatible
    })
    if (!existing) peerContractChecks.set(requestKey, request)
    try {
      const compatible = await request
      const current = store().workspace
      if (current?.project?.id !== projectID || current.project.rootPath !== projectRoot || !current.graph.services.some((candidate) => candidate.id === callerServiceID) ||
          !current.graph.services.some((candidate) => candidate.id === targetServiceID)) throw new Error('peer.context_changed')
      return compatible
    } finally { if (peerContractChecks.get(requestKey) === request) peerContractChecks.delete(requestKey) }
  }

  async function pluginPatchServiceSettings(projectID: string, serviceID: string, path: string[], value: unknown) {
    const { key, service } = pluginServiceContext(projectID, serviceID)
    await loadServiceSettingsDraft(service)
    assertPluginContext(projectID, serviceID, key)
    try {
      requireMatchedConfigurationContract(key)
    } catch (reason: unknown) {
      const draft = store().serviceSettingsDrafts[key]
      if (draft?.configurationContractState === 'mismatch' && draft.configurationContractMismatchKind === 'provenance') {
        // Starting Core cannot repair a Project/artifact provenance mismatch:
        // it may restart an already-running target without changing its
        // reviewed binary. Keep this path read-only and require the operator
        // to inspect/review a Core binary update in Local Core settings.
        throw new Error('bridge.provenance_mismatch', { cause: reason })
      } else {
        const code = draft?.configurationContractState !== 'mismatch'
          ? 'bridge.schema_unverified'
          : 'bridge.schema_mismatch'
        throw new Error(code, { cause: reason })
      }
    }
    const operations = configurationArrayOperations(value)
    const previousDraft = store().serviceSettingsDrafts[key]
    const previousRevision = previousDraft?.revision
    const expectedArray = operations && previousDraft?.schema
      ? readDraftArray(previousDraft.base, previousDraft.patch, path, operations)
      : null
    try {
      store().updateServiceSettingsDraft(key, path, value)
    } catch (reason: unknown) {
      throw new Error(classifyStudioPluginPatchFailure(reason))
    }
    const updatedDraft = store().serviceSettingsDrafts[key]
    // Studio plugins must never receive a successful acknowledgement for a
    // structural edit that the shared draft silently ignored (e.g. while a
    // schema refresh or conflict is active).
    if (operations) {
      const actualArray = updatedDraft?.schema
        ? readDraftArray(updatedDraft.base, updatedDraft.patch, path)
        : null
      if (updatedDraft?.revision === previousRevision) throw new Error('bridge.patch_draft_unchanged')
      if (expectedArray === null || actualArray === null) throw new Error('bridge.patch_projection_unavailable')
      if (!configurationValuesEqual(expectedArray, actualArray)) throw new Error('bridge.patch_projection_mismatch')
    }
    await persistServiceSettingsDraft(key, () => pluginContextIsCurrent(projectID, serviceID, key), false)
    assertPluginContext(projectID, serviceID, key)
    return pluginSettingsSnapshot(key)
  }

  async function pluginSaveServiceSettings(projectID: string, serviceID: string, allowIncomplete = false) {
    const { key, service } = pluginServiceContext(projectID, serviceID)
    await loadServiceSettingsDraft(service)
    assertPluginContext(projectID, serviceID, key)
    // A schema that was imported into the Project remains the local write
    // contract even when Core is temporarily unavailable or its live schema
    // differs. Persisting a validated draft is safe; saveServiceSettingsDraft
    // only auto-applies after a live contract has been verified.
    await queueSettingsOperation(() => saveServiceSettingsDraftNow(key, true, () => pluginContextIsCurrent(projectID, serviceID, key), allowIncomplete))
    assertPluginContext(projectID, serviceID, key)
    return pluginSettingsSnapshot(key)
  }

  function persistServiceSettingsDraft(key: string, contextIsCurrent?: () => boolean, autoApply = true): Promise<void> {
    const activeTimer = settingsPersistTimers.get(key)
    if (activeTimer) {
      clearTimeout(activeTimer.timer)
      activeTimer.resolve()
    }
    if (autoApply) scheduleServiceAutoApply(key)
    else {
      const pendingApply = settingsApplyTimers.get(key)
      if (pendingApply) clearTimeout(pendingApply)
      settingsApplyTimers.delete(key)
    }
    return new Promise((resolve) => {
      const pending = { timer: setTimeout(() => {
        settingsPersistTimers.delete(key)
        settingsPersistenceQueue = settingsPersistenceQueue.catch(() => undefined).then(async () => {
          if (contextIsCurrent && !contextIsCurrent()) return
          const draft = store().serviceSettingsDrafts[key]
          if (!draft?.schema || draft.status === 'loading' || draft.status === 'saving' || draft.status === 'conflict') return
          if (isConfigurationPatchEmpty(draft.patch)) {
            await api.deleteServiceSettingsDraft(draft.projectId, draft.serviceId)
            return
          }
          await api.saveServiceSettingsDraft(draft.projectId, draft.serviceId, draft.baseDigest, JSON.stringify(draft.patch))
        }).catch((reason: unknown) => {
          store().setServiceSettingsDraftError(key, messageOf(reason, 'Settings draft could not be persisted'))
        }).finally(resolve)
      }, 180), resolve }
      settingsPersistTimers.set(key, pending)
    })
  }

  async function flushServiceSettingsDraft(key: string): Promise<void> {
    const pending = settingsPersistTimers.get(key)
    if (pending) {
      clearTimeout(pending.timer)
      settingsPersistTimers.delete(key)
      pending.resolve()
    }
    await settingsPersistenceQueue.catch(() => undefined)
    const draft = store().serviceSettingsDrafts[key]
    if (!draft?.schema || draft.status === 'loading' || draft.status === 'saving' || draft.status === 'conflict') return
    const operation = settingsPersistenceQueue.catch(() => undefined).then(async () => {
      const current = store().serviceSettingsDrafts[key]
      if (!current?.schema || current.status === 'loading' || current.status === 'saving' || current.status === 'conflict') return
      if (isConfigurationPatchEmpty(current.patch)) await api.deleteServiceSettingsDraft(current.projectId, current.serviceId)
      else await api.saveServiceSettingsDraft(current.projectId, current.serviceId, current.baseDigest, JSON.stringify(current.patch))
    }).catch((reason: unknown) => {
      store().setServiceSettingsDraftError(key, messageOf(reason, 'Settings draft could not be persisted'))
      throw reason
    })
    settingsPersistenceQueue = operation.catch(() => undefined)
    await operation
  }

  function undoServiceSettingsDraft(key: string): Promise<void> {
    const before = store().serviceSettingsDrafts[key]?.revision
    store().undoServiceSettingsDraft(key)
    return store().serviceSettingsDrafts[key]?.revision === before ? Promise.resolve() : persistServiceSettingsDraft(key)
  }

  function redoServiceSettingsDraft(key: string): Promise<void> {
    const before = store().serviceSettingsDrafts[key]?.revision
    store().redoServiceSettingsDraft(key)
    return store().serviceSettingsDrafts[key]?.revision === before ? Promise.resolve() : persistServiceSettingsDraft(key)
  }

  function scheduleServiceAutoApply(key: string): void {
    const previous = settingsApplyTimers.get(key)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      settingsApplyTimers.delete(key)
      const draft = store().serviceSettingsDrafts[key]
      const activeProject = store().workspace?.project
      if (!draft?.schema || draft.status !== 'dirty' || isConfigurationPatchEmpty(draft.patch)) return
      if (!activeProject || activeProject.id !== draft.projectId || activeProject.rootPath !== draft.projectRoot) return
      void queueSettingsAutoApply(key)
    }, 800)
    settingsApplyTimers.set(key, timer)
  }

  function saveServiceSettingsDraft(key: string, contextIsCurrent?: () => boolean): Promise<void> {
    return queueSettingsOperation(() => saveServiceSettingsDraftNow(key, true, contextIsCurrent))
  }

  async function saveServiceSettingsDraftNow(key: string, applyAfterSave: boolean, contextIsCurrent?: () => boolean, allowIncomplete = false): Promise<void> {
    await persistServiceSettingsDraft(key, contextIsCurrent, applyAfterSave)
    if (contextIsCurrent && !contextIsCurrent()) throw new Error('bridge.context_changed')
    const pendingApply = settingsApplyTimers.get(key)
    if (pendingApply) clearTimeout(pendingApply)
    settingsApplyTimers.delete(key)
    const draft = store().serviceSettingsDrafts[key]
    if (!draft) return
    const newlySensitivePaths = configurationApplyReviewDiff(draft.base, draft.patch).map((path) => `${draft.serviceId}.${path}`)
    const pendingReviewPaths = [...new Set([
      ...(store().applyRecoveryStatus === 'confirmation-required' ? store().applyReviewPaths : []),
      ...newlySensitivePaths,
    ])].slice(0, 64)
    const revision = store().beginServiceSettingsDraftSave(key)
    if (revision === null) return
    const scope = settingsApplyScope(draft.projectId, draft.projectRoot)
    const canApply = applyAfterSave && !pausedSettingsApplyScopes.has(scope) && draft.configurationContractState === 'matched' && pendingReviewPaths.length === 0
    let savedToProject = false
    try {
      if (contextIsCurrent && !contextIsCurrent()) throw new Error('bridge.context_changed')
      if (!await persistApplyRecovery(draft.projectId, draft.projectRoot, canApply ? 'applying' : 'confirmation-required', null, pendingReviewPaths)) {
        throw new Error('Could not persist the apply recovery state; settings were not written. Reopen the Project and retry explicitly.')
      }
      if (contextIsCurrent && !contextIsCurrent()) {
        await persistApplyRecovery(draft.projectId, draft.projectRoot, 'confirmation-required', null, pendingReviewPaths)
        throw new Error('bridge.context_changed')
      }
      const encodedPatch = new TextEncoder().encode(JSON.stringify(draft.patch))
      if (allowIncomplete) {
        if (!api.writeProjectCandidateSettings) throw new Error('Project candidate save is unavailable')
        await api.writeProjectCandidateSettings(draft.projectId, draft.serviceId, draft.baseDigest, encodedPatch)
      } else {
        await api.writeProjectSettings(draft.projectId, draft.serviceId, draft.baseDigest, encodedPatch)
      }
      const snapshot = await api.readProjectSettings(draft.projectId, draft.serviceId)
      const base = asConfigurationObject(JSON.parse(snapshot.valuesJson) as unknown)
      if (!base || !snapshot.digest) throw new Error('Saved settings could not be reloaded as a safe snapshot')
      store().completeServiceSettingsDraftSave(key, revision, base, snapshot.digest, snapshot.configurationDigest)
      savedToProject = true
      try { await api.deleteServiceSettingsDraft(draft.projectId, draft.serviceId) }
      catch { store().setServiceSettingsDraftError(key, 'Project was saved, but the local draft could not be cleared') }
    } catch (reason: unknown) {
      const message = messageOf(reason, 'Settings were not saved')
      const conflict = /changed since|conflict/i.test(message)
      store().failServiceSettingsDraftSave(key, revision, message, conflict)
      setPausedSettingsApplyScope(draft.projectId, draft.projectRoot, true)
      await persistApplyRecovery(draft.projectId, draft.projectRoot, 'confirmation-required', null, pendingReviewPaths)
      if (conflict) {
        try {
          const snapshot = await api.readProjectSettings(draft.projectId, draft.serviceId)
          const base = asConfigurationObject(JSON.parse(snapshot.valuesJson) as unknown)
          if (base && snapshot.digest) store().refreshServiceSettingsDraftConflict(key, base, snapshot.digest, message)
        } catch { /* keep the original draft and its conflict visible */ }
      }
    }
    if (savedToProject && canApply) {
      await runDevApply(draft.projectId, draft.projectRoot, false, true)
    } else if (savedToProject) {
      setPausedSettingsApplyScope(draft.projectId, draft.projectRoot, true)
      await persistApplyRecovery(draft.projectId, draft.projectRoot, 'confirmation-required', null, pendingReviewPaths)
    }
  }

  function applyServiceSettings(key: string): Promise<void> {
    return queueSettingsOperation(() => {
      const draft = requireMatchedConfigurationContract(key)
      if (draft.status !== 'clean' || !isConfigurationPatchEmpty(draft.patch)) {
        throw new Error('Save or discard the settings draft before applying the Project to Core.')
      }
      return runDevApply(draft.projectId, draft.projectRoot, true)
    })
  }

  function retryFailedServiceSettings(key: string): Promise<void> {
    return queueSettingsOperation(() => {
      const draft = requireMatchedConfigurationContract(key)
      if (draft.status !== 'clean' || !isConfigurationPatchEmpty(draft.patch)) {
        throw new Error('Save or discard the settings draft before retrying a failed Core operation.')
      }
      return runDevApply(draft.projectId, draft.projectRoot, true, false, true)
    })
  }

  function requireMatchedConfigurationContract(key: string) {
    const draft = store().serviceSettingsDrafts[key]
    if (!draft || draft.configurationContractState !== 'matched') {
      throw new Error(draft?.configurationContractState === 'mismatch' ? 'Live service schema differs from the Project schema' : 'Live service schema has not been verified through Core')
    }
    return draft
  }

  async function runDevApply(projectID: string, projectRoot: string, explicit: boolean, recoveryPrepared = false, retryFailed = false): Promise<void> {
    const scope = settingsApplyScope(projectID, projectRoot)
    if (explicit) setPausedSettingsApplyScope(projectID, projectRoot, false)
    else if (pausedSettingsApplyScopes.has(scope)) return
    store().setError(null)
    let operationId: WorkspaceApplyRecoveryOperationId = null
    let operationState = ''
    let operationMarkerWrite: Promise<boolean> = Promise.resolve(true)
    let unsubscribe: (() => void) | null = null
    try {
      const activeProject = store().workspace?.project
      if (!activeProject || activeProject.id !== projectID || activeProject.rootPath !== projectRoot) {
        throw new Error('The Project workspace changed before apply; reopen the saved Project and retry.')
      }
      try {
        await refreshOpenServiceConfigurationContracts(projectID, projectRoot)
      } catch (reason: unknown) {
        setPausedSettingsApplyScope(projectID, projectRoot, true)
        fail(reason, 'Live service contract or artifact provenance changed; Core apply was not started.')
        return
      }
      if (!recoveryPrepared && !await persistApplyRecovery(projectID, projectRoot, 'applying', null, [])) {
        throw new Error('Could not persist the apply recovery state; the Core apply was not started.')
      }
      unsubscribe = api.onCLIEvent((event) => {
        if (event.type !== 'operation.updated' || event.target !== 'local' || !isSafeApplyOperationID(event.operationId)) return
        if (operationId && event.operationId !== operationId) return
        if (!operationId) {
          operationId = event.operationId
          operationMarkerWrite = persistApplyRecovery(projectID, projectRoot, 'applying', operationId)
        }
        operationState = event.state ?? ''
      })
      await api.runStudioCommandAndWait(retryFailed ? 'dev.apply.retryFailed' : 'dev.apply', 'local')
      await operationMarkerWrite
      setPausedSettingsApplyScope(projectID, projectRoot, false)
      if (!await persistApplyRecovery(projectID, projectRoot, 'none')) {
        setPausedSettingsApplyScope(projectID, projectRoot, true)
        fail(new Error('Core apply completed, but Studio could not clear its recovery marker. Reopen the Project and explicitly confirm/retry.'), 'Не удалось сохранить результат применения')
        return
      }
      await refreshRuntimeStatuses()
    } catch (reason: unknown) {
      await operationMarkerWrite
      setPausedSettingsApplyScope(projectID, projectRoot, true)
      const unresolvedOperationId = operationState === 'failed' || operationState === 'degraded' ? null : operationId
      await persistApplyRecovery(projectID, projectRoot, 'confirmation-required', unresolvedOperationId)
      fail(reason, 'Настройки сохранены в Project, но применение к локальному Core не удалось. Проверьте CLI/Core и повторите применение.')
    } finally {
      unsubscribe?.()
    }
  }

  async function reconcileApplyRecovery(): Promise<void> {
    const project = store().workspace?.project
    const operationId = store().applyRecoveryOperationId
    if (!project || !isSafeApplyOperationID(operationId)) {
      fail(new Error('No safe Core operation ID is available; review the saved Project and explicitly retry apply.'), 'Не удалось проверить операцию Core')
      return
    }

    let operationState = ''
    const unsubscribe = api.onCLIEvent((event) => {
      if (event.type === 'operation.updated' && event.target === 'local' && event.operationId === operationId) {
        operationState = event.state ?? operationState
      }
    })
    try {
      await api.runStudioCommandAndWait('operation.watch', 'local', operationId)
    } catch (reason: unknown) {
      const unresolvedOperationId = operationState === 'failed' || operationState === 'degraded' ? null : operationId
      await persistApplyRecovery(project.id, project.rootPath, 'confirmation-required', unresolvedOperationId)
      fail(reason, 'Не удалось получить подтверждённое состояние Core operation')
      return
    } finally {
      unsubscribe()
    }

    if (operationState === 'succeeded' || operationState === 'completed') {
      setPausedSettingsApplyScope(project.id, project.rootPath, false)
      if (!await persistApplyRecovery(project.id, project.rootPath, 'none')) {
        setPausedSettingsApplyScope(project.id, project.rootPath, true)
        fail(new Error('Core reports success, but Studio could not clear its recovery marker'), 'Не удалось сохранить результат применения')
        return
      }
      await refreshRuntimeStatuses()
      return
    }

    setPausedSettingsApplyScope(project.id, project.rootPath, true)
    await persistApplyRecovery(project.id, project.rootPath, 'confirmation-required', operationId)
    fail(new Error(`Core operation state was not a successful terminal state: ${operationState || 'unknown'}`), 'Применение не подтверждено; проверьте состояние Core перед повтором')
  }

  function settingsApplyScope(projectID: string, projectRoot: string): string {
    return `${projectID}\u0000${projectRoot}`
  }

  function setPausedSettingsApplyScope(projectID: string, projectRoot: string, paused: boolean): void {
    const scope = settingsApplyScope(projectID, projectRoot)
    if (paused) pausedSettingsApplyScopes.add(scope)
    else pausedSettingsApplyScopes.delete(scope)
  }

  function persistApplyRecovery(projectID: string, projectRoot: string, status: WorkspaceApplyRecoveryStatus, operationId: WorkspaceApplyRecoveryOperationId = null, reviewPaths?: string[]): Promise<boolean> {
    const activeProject = store().workspace?.project
    if (!activeProject || activeProject.id !== projectID || activeProject.rootPath !== projectRoot) return Promise.resolve(false)
    const next = persistenceQueue.catch(() => undefined).then(async () => {
      const currentProject = store().workspace?.project
      if (!currentProject || currentProject.id !== projectID || currentProject.rootPath !== projectRoot) return false
      const current = await api.readWorkspaceState()
      const projectAfterRead = store().workspace?.project
      if (!projectAfterRead || projectAfterRead.id !== projectID || projectAfterRead.rootPath !== projectRoot) return false
      if (current.projectId && current.projectId !== projectID) throw new Error('Workspace state belongs to a different Project')
      const retainedReviewPaths = status === 'none' ? [] : reviewPaths ?? store().applyReviewPaths
      await api.writeWorkspaceState(workspaceStateWithApplyRecovery({ ...current, projectId: projectID }, status, operationId, retainedReviewPaths))
      const latestProject = store().workspace?.project
      if (latestProject?.id === projectID && latestProject.rootPath === projectRoot) {
        const safeOperationId = status !== 'none' && isSafeApplyOperationID(operationId) ? operationId : null
        store().setApplyRecovery(status, safeOperationId, retainedReviewPaths)
      }
      return true
    })
    persistenceQueue = next.then(() => undefined, () => undefined)
    return next.catch((reason: unknown) => {
      fail(reason, 'Не удалось сохранить состояние восстановления применения')
      return false
    })
  }

  async function discardServiceSettingsDraft(key: string, service?: RuntimeService): Promise<void> {
    const draft = store().serviceSettingsDrafts[key]
    if (!draft) return
    const pendingApply = settingsApplyTimers.get(key)
    if (pendingApply) clearTimeout(pendingApply)
    settingsApplyTimers.delete(key)
    const timer = settingsPersistTimers.get(key)
    if (timer) { clearTimeout(timer.timer); timer.resolve(); settingsPersistTimers.delete(key) }
    try {
      await settingsPersistenceQueue.catch(() => undefined)
      await api.deleteServiceSettingsDraft(draft.projectId, draft.serviceId)
      if (draft.schema) store().discardServiceSettingsDraft(key)
      else {
        store().removeServiceSettingsDraft(key)
        if (service) await loadServiceSettingsDraft(service)
      }
    } catch (reason: unknown) {
      store().setServiceSettingsDraftError(key, messageOf(reason, 'Settings draft could not be deleted'))
    }
  }

  async function addService(artifact: ArtifactReference, name: string) {
    const id = artifact.id.trim()
    if (!id || !name.trim() || !artifact.trusted) return
    const input: RuntimeServiceInput = { id, name: name.trim(), version: artifact.version, manifestVersion: 'v1', settingsSchemaPath: '' }
    try {
      await api.createRuntimeService(input)
      const workspace = await api.bindRuntimeServiceArtifact(store().workspace?.project?.id ?? '', id, artifact.version, artifact.platform)
      store().setWorkspace(workspace); store().setServiceOpen(false); store().setField('serviceID', ''); store().setField('serviceName', ''); store().setSelected({ kind: 'service', id }); store().setError(null)
    } catch (reason: unknown) { fail(reason, 'Не удалось подключить сервис из локального каталога') }
  }

  async function createLink(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const input: ServiceLinkInput = { id: `${connection.source}-${connection.target}`, caller: connection.source, target: connection.target, contractVersion: 'v1', methods: ['invoke'], transport: 'local', requestSchemaPath: '', responseSchemaPath: '', contractSchemaPath: '', securityProfile: 'default', timeoutMillis: 30000, retryLimit: 0, requestLimitBytes: 1048576, responseLimitBytes: 1048576, disabledMethods: [], compatibility: 'strict', redactionPolicy: 'schema' }
    try { store().setWorkspace(await api.createServiceLink(input)); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось создать связь') }
  }

  async function updateServiceLink(input: ServiceLinkInput) {
    try { store().setWorkspace(await api.updateServiceLink(input)); store().setSelected({ kind: 'link', id: input.id }); store().setError(null) }
    catch (reason: unknown) { fail(reason, 'Не удалось обновить контракт связи') }
  }

  async function deleteNodes(ids: string[]) { try { let workspace = store().workspace; for (const id of ids) workspace = await api.deleteRuntimeService(id, true); store().setWorkspace(workspace); store().setSelected(null); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось удалить сервис') } }
  async function deleteEdges(ids: string[]) { try { let workspace = store().workspace; for (const id of ids) { const link = workspace?.graph.links.find((item) => item.id === id); if (workspace && link) workspace = await api.deleteServiceLink(link.caller, link.id, true) }; store().setWorkspace(workspace); store().setSelected(null); store().setError(null) } catch (reason: unknown) { fail(reason, 'Не удалось удалить связь') } }

  function persistNodePosition(id: string, position: LayoutPoint) { store().setLayout({ ...store().layout, [id]: position }) }
  async function persistWorkspace() {
    const state = store(); const project = state.workspace?.project
    if (!project || !state.stateHydrated) return
    const snapshot = workspaceSnapshot({ activeTabId: state.activeTabId, tabs: state.tabs, layout: state.layout })
    const projectId = project.id
    persistenceQueue = persistenceQueue.catch(() => undefined).then(async () => {
      try {
        const current = await api.readWorkspaceState()
        if (store().workspace?.project?.id !== projectId) return
        await api.writeWorkspaceState(workspaceStateUpdate({ ...current, projectId }, snapshot))
      } catch { /* workspace persistence is best-effort and never blocks interaction */ }
    })
    await persistenceQueue
  }
  async function setLocale(locale: Locale) { store().setLocaleState(locale); try { await api.saveClientLocale(locale) } catch (reason: unknown) { fail(reason, 'Не удалось сохранить язык') } }
  async function setTheme(theme: ThemePreference) { store().setThemeState(theme); try { await api.saveClientPreferences(theme) } catch (reason: unknown) { fail(reason, 'Не удалось сохранить тему') } }
  async function loadDiagnostics() { try { store().setDiagnostics(await api.diagnostics()) } catch { store().setDiagnostics([]) } }
  async function loadTraffic() { try { store().setTraffic(await api.trafficRecords()) } catch { store().setTraffic([]) } }
  async function exportTrafficReport(): Promise<string | null> { try { const path = await api.exportTrafficReport(); store().setError(null); return path } catch (reason: unknown) { fail(reason, 'Не удалось экспортировать отчёт'); return null } }
  async function listArtifacts(): Promise<ArtifactReference[]> { try { return await api.listRuntimeArtifacts() } catch (reason: unknown) { fail(reason, 'Не удалось получить список бинарников'); return [] } }
  async function registerArtifact(id: string, version: string, platform: string, path: string): Promise<ArtifactReference | null> { try { const artifact = await api.registerRuntimeArtifact(id, version, platform, path); store().setError(null); return artifact } catch (reason: unknown) { fail(reason, 'Не удалось зарегистрировать бинарник'); return null } }
  async function trustArtifact(id: string, version: string, platform: string, digest: string): Promise<ArtifactReference | null> { try { const artifact = await api.trustRuntimeArtifact(id, version, platform, digest); store().setError(null); return artifact } catch (reason: unknown) { fail(reason, 'Не удалось подтвердить доверие к бинарнику'); return null } }
  async function removeArtifact(artifact: ArtifactReference): Promise<boolean> {
    try {
      await api.removeRuntimeArtifact(artifact.id, artifact.version, artifact.platform, artifact.digest, true)
      store().setError(null)
      return true
    } catch (reason: unknown) {
      fail(reason, 'Не удалось удалить запись бинарника')
      return false
    }
  }
  async function bindRuntimeServiceArtifact(serviceID: string, version: string, platform: string): Promise<boolean> {
    const project = store().workspace?.project
    if (!project) return false
    try {
      const workspace = await api.bindRuntimeServiceArtifact(project.id, serviceID, version, platform)
      if (store().workspace?.project?.id !== project.id) return false
      store().setWorkspace(workspace)
      store().setError(null)
      return true
    } catch (reason: unknown) {
      fail(reason, 'Не удалось привязать бинарник к сервису')
      return false
    }
  }
  async function serviceMetadata(serviceID: string, view: 'manifest' | 'schema' | 'status'): Promise<string | null> { const projectID = store().workspace?.project?.id; if (!projectID) return null; try { const value = await queueCoreMetadataRead(() => api.readRuntimeServiceMetadata(projectID, serviceID, view)); store().setRuntimeOutput(value); store().navigate('output'); return value } catch (reason: unknown) { fail(reason, `Не удалось получить ${view} через Core`); return null } }
  async function loadStudioPluginSurfaces(): Promise<StudioPluginSurface[]> {
    try {
      const packages = await installedStudioPluginPackages()
      const surfaces = packages.flatMap((plugin) => plugin.surfaces.filter((surface) => surface.route).map((surface) => ({
        studioPluginId: plugin.id, version: plugin.version, id: surface.id, title: surface.title, route: surface.route, context: surface.context,
        permissions: plugin.permissions, grantedPermissions: plugin.grantedPermissions,
      })))
      store().setStudioPluginSurfaces(surfaces)
      return surfaces
    } catch {
      store().setStudioPluginSurfaces([])
      return []
    }
  }
  async function installedStudioPluginPackages(): Promise<StudioPluginPackageInfo[]> {
    return parseInstalledStudioPluginInspections(await api.installedStudioPluginManifests())
  }
  async function studioPluginEditorBindings(): Promise<Array<{ buttonId: string; pluginId: string; surfaceId: string }>> {
    const value: unknown = JSON.parse(await api.studioPluginEditorBindings())
    if (!Array.isArray(value) || value.length > 256) return []
    const bindings: Array<{ buttonId: string; pluginId: string; surfaceId: string }> = []
    for (const item of value) {
      if (!isRecord(item) || typeof item.buttonId !== 'string' || typeof item.pluginId !== 'string' || typeof item.surfaceId !== 'string') continue
      bindings.push({ buttonId: item.buttonId, pluginId: item.pluginId, surfaceId: item.surfaceId })
    }
    return bindings
  }
  async function saveStudioPluginEditorBindings(bindings: Array<{ buttonId: string; pluginId: string; surfaceId: string }>): Promise<void> {
    await api.saveStudioPluginEditorBindings(JSON.stringify(bindings))
  }
  async function serviceEditorButtonCandidates(): Promise<ServiceEditorButtonCandidate[]> {
    const workspace = store().workspace
    const projectID = workspace?.project?.id
    if (!workspace || !projectID) return []
    const results = await Promise.all(workspace.graph.services.map(async (service) => {
      try { return (await readServiceEditorButtons(projectID, service.id)).map((button) => ({ ...button, serviceId: service.id, serviceName: service.name })) }
      catch { return [] }
    }))
    return results.flat()
  }
  async function readServiceEditorButtons(projectID: string, serviceID: string) {
    return queueCoreMetadataRead(async () => {
      const buttons = parseServiceEditorButtons(await api.readRuntimeServiceMetadata(projectID, serviceID, 'manifest'), serviceID)
      if (buttons.length > 0) {
        const bindings = await studioPluginEditorBindings()
        const next = assignSingleServiceEditorPages(buttons, bindings, latestStudioPluginSurfaces(store().studioPluginSurfaces))
        if (next.length !== bindings.length) await saveStudioPluginEditorBindings(next)
      }
      return buttons
    })
  }
  async function selectStudioPluginPackage(): Promise<string> {
    return api.selectStudioPluginPackage()
  }
  async function inspectStudioPluginPackage(packagePath: string): Promise<StudioPluginPackageInfo> {
    if (!packagePath) throw new Error('Select a .studio-plugin package first')
    return parseStudioPluginInspection(await api.inspectStudioPlugin(packagePath))
  }
  async function installStudioPluginPackage(packagePath: string, inspection: StudioPluginPackageInfo, reason: string): Promise<void> {
    const installedValue: unknown = JSON.parse(await api.installStudioPlugin(packagePath, inspection.digest, true, reason.trim(), inspection.permissions))
    if (!installedValue || typeof installedValue !== 'object' || Array.isArray(installedValue)) throw new Error('Studio returned an invalid installation result')
    const installed = installedValue as Record<string, unknown>
    const manifest = installed.manifest
    if (installed.digest !== inspection.digest || !manifest || typeof manifest !== 'object' || !('id' in manifest) || !('version' in manifest) || manifest.id !== inspection.id || manifest.version !== inspection.version) {
      throw new Error('Installed Studio plugin does not match the reviewed package')
    }
    await loadStudioPluginSurfaces()
  }
  async function removeStudioPluginPackage(id: string, version: string): Promise<void> {
    await api.removeStudioPlugin(id, version)
    for (const tab of store().tabs) {
      if (tab.kind === 'studio-plugin' && tab.studioPluginId === id && tab.studioPluginVersion === version) store().closeTab(tab.id)
    }
    await loadStudioPluginSurfaces()
  }
  async function runtimeCommand(command: 'runtime.start' | 'runtime.stop' | 'runtime.restart' | 'runtime.logs' | 'runtime.inspect', serviceID: string) {
    try {
      await api.runStudioRuntimeCommand(command, serviceID)
      store().navigate('output'); store().setError(null)
      if (command === 'runtime.start' || command === 'runtime.restart' || command === 'runtime.stop') {
        await refreshRuntimeStatuses()
        await refreshOpenServiceConfigurationContracts()
      }
    } catch (reason: unknown) { fail(reason, `Не удалось выполнить ${command} для ${serviceID}`) }
  }
  return { api, refresh, refreshGraph, refreshRuntimeStatuses, openProject, createProject, openFileExternally, run, cancelCLI, runtimeCommand, loadServiceSettingsDraft, importServiceSettingsSchema, previewServiceSettingsSchema, refreshServiceSettingsSchema, refreshServiceSettingsContract, persistServiceSettingsDraft, undoServiceSettingsDraft, redoServiceSettingsDraft, saveServiceSettingsDraft, applyServiceSettings, retryFailedServiceSettings, reconcileApplyRecovery, discardServiceSettingsDraft, pluginReadServiceSettings, pluginReadServiceConfigurationUI, pluginReadServiceResource, pluginReadServiceSecretReferences, pluginSelectServiceSecretReference, pluginCreateServiceSettingsRecoveryCopy, pluginReadServiceAdminSurface, pluginReadServiceAdminTable, pluginInvokeServiceAdminAction, pluginSelectServiceResourceArtifact, importProjectCertificateResource, pluginPublishServiceResource, pluginWatchServiceResourceOperation, pluginReadServicePeerCatalog, verifyServicePeerContract, readServiceResourceCatalog, pluginPatchServiceSettings, pluginSaveServiceSettings, addService, createLink, updateServiceLink, deleteNodes, deleteEdges, persistNodePosition, persistWorkspace, setLocale, setTheme, loadDiagnostics, loadTraffic, exportTrafficReport, listArtifacts, registerArtifact, trustArtifact, removeArtifact, bindRuntimeServiceArtifact, serviceMetadata, loadStudioPluginSurfaces, installedStudioPluginPackages, studioPluginEditorBindings, saveStudioPluginEditorBindings, serviceEditorButtonCandidates, readServiceEditorButtons, selectStudioPluginPackage, inspectStudioPluginPackage, installStudioPluginPackage, removeStudioPluginPackage }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeServiceAdminActionInput(value: unknown, depth = 0): boolean {
  if (depth > 16) return false
  if (Array.isArray(value)) return value.length <= 512 && value.every((item) => isSafeServiceAdminActionInput(item, depth + 1))
  if (isRecord(value)) {
    const entries = Object.entries(value)
    return entries.length <= 512 && entries.every(([key, child]) =>
      !/(?:secret|password|passwd|token|private.?key|credential|authorization|authkey)/iu.test(key) &&
      isSafeServiceAdminActionInput(child, depth + 1))
  }
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function safeResourceText(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[\0\r\n]/u.test(value)
}

function safePeerIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
}

function safePeerText(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\0\r\n\p{Cc}]/u.test(value)
}

function readDraftArray(base: ConfigurationObject, patch: ConfigurationObject, path: string[], operations?: ReturnType<typeof configurationArrayOperations>): unknown[] | null {
  let current: unknown = mergeConfiguration(base, patch)
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) return null
    current = (current as Record<string, unknown>)[segment]
  }
  if (!Array.isArray(current)) return null
  const currentArray: unknown[] = current
  return operations ? applyConfigurationArrayOperations(currentArray, operations) : currentArray
}

function classifyStudioPluginPatchFailure(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : ''
  if (message.startsWith('bridge.')) return message
  if (message.includes('does not match its schema')) return 'bridge.patch_schema_mismatch'
  if (message.includes('only supported for protected arrays')) return 'bridge.patch_array_contract_mismatch'
  if (message.includes('unknown, read-only, or sensitive')) return 'bridge.patch_path_rejected'
  if (/array|collection|item index|insertion index/iu.test(message)) return 'bridge.patch_array_rejected'
  return 'bridge.patch_rejected'
}
