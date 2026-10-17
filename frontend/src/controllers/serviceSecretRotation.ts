import type { StudioController } from './studioController'
import { configurationDraftKey } from '../models/configurationDraft'
import { serviceSecretReferencePaths } from '../models/serviceSecrets'

type RotationController = Pick<StudioController,
  'pluginReadServiceSettings' | 'pluginPatchServiceSettings' | 'pluginSaveServiceSettings' | 'applyServiceSettings' | 'retryFailedServiceSettings'>

const opaqueReferencePattern = /^ssr:v1:[a-f0-9]{32}$/u
const maximumRotationPaths = 64

export async function replaceServiceSecretReferencesAndSave(
  controller: RotationController,
  projectID: string,
  serviceID: string,
  previousReference: string,
  createdReference: string,
  paths: string[][],
): Promise<void> {
  if (!projectID || !serviceID || !opaqueReferencePattern.test(previousReference) || !opaqueReferencePattern.test(createdReference) ||
      previousReference === createdReference || paths.length === 0 || paths.length > maximumRotationPaths ||
      paths.some((path) => path.length === 0 || path.length > 64 || path.some((segment) => !segment || segment.length > 256))) {
    throw new Error('secret_rotation_request_invalid')
  }
  const settings = await controller.pluginReadServiceSettings(projectID, serviceID)
  requireCleanSettings(settings)
  const currentPaths = serviceSecretReferencePaths(settings.values, previousReference)
  if (!samePathSet(currentPaths, paths)) throw new Error('secret_rotation_project_changed')

  for (const path of paths) {
    await controller.pluginPatchServiceSettings(projectID, serviceID, path, createdReference)
  }
  const saved = await controller.pluginSaveServiceSettings(projectID, serviceID)
  if (saved.status !== 'clean' || saved.errorCode !== '') throw new Error('secret_rotation_project_save_failed')
}

export async function applySavedServiceSecretRotation(
  controller: RotationController,
  projectID: string,
  projectRoot: string,
  serviceID: string,
  previousReference: string,
  createdReference: string,
  retryFailed = false,
): Promise<void> {
  if (!projectID || !projectRoot || !serviceID || !opaqueReferencePattern.test(previousReference) ||
      !opaqueReferencePattern.test(createdReference) || previousReference === createdReference) {
    throw new Error('secret_rotation_request_invalid')
  }
  const settings = await controller.pluginReadServiceSettings(projectID, serviceID)
  requireCleanSettings(settings)
  if (serviceSecretReferencePaths(settings.values, previousReference).length > 0 ||
      serviceSecretReferencePaths(settings.values, createdReference).length === 0) {
    throw new Error('secret_rotation_project_not_ready')
  }
  const draftKey = configurationDraftKey(projectRoot, serviceID)
  if (retryFailed) await controller.retryFailedServiceSettings(draftKey)
  else await controller.applyServiceSettings(draftKey)
}

function requireCleanSettings(settings: Awaited<ReturnType<RotationController['pluginReadServiceSettings']>>): void {
  if (settings.status !== 'clean' || Object.keys(settings.patch).length > 0) throw new Error('secret_rotation_unsaved_settings')
}

function samePathSet(left: string[][], right: string[][]): boolean {
  if (left.length !== right.length) return false
  const leftPaths = left.map((path) => JSON.stringify(path)).sort()
  const rightPaths = right.map((path) => JSON.stringify(path)).sort()
  return leftPaths.every((path, index) => path === rightPaths[index])
}
