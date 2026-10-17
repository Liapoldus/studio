import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const modelModule = "// Prepared by scripts/bindings/prepare.mts.\nexport { ArtifactReference, Diagnostic, InstalledStudioPluginState, ServiceLink, ServiceArtifactReference, RuntimeService, ServiceGraph, ServiceLinkInput, ServiceSettingsSchemaPreview, ProductInfo, Project, ProjectFile, RuntimeServiceInput, ToolchainStatus, TrafficRecordView, Workspace, WorkspaceState, models } from '../../src/api/info'\nexport type { ReportSummary } from '../../src/api/info'\n"

// Fail closed when the canonical Go model changes.
export function prepareModels(source: string): string {
  if (source === modelModule) return source
  const classes = [...source.matchAll(/export class (\w+)/gu)].map(match => match[1])
  const fields = [...source.matchAll(/^\s+(\w+\??): ([^;\n]+);$/gmu)]
    .map(match => `${match[1]}:${match[2]}`)
  const exports = [...source.matchAll(/\bexport (namespace|class|interface|enum|type) (\w+)/gu)]
    .map(match => `${match[1]}:${match[2]}`)
  const expectedClasses = ['ArtifactReference', 'Diagnostic', 'InstalledStudioPluginState', 'ProductInfo', 'Project', 'ProjectFile', 'ReportSummary', 'ServiceArtifactReference', 'RuntimeService', 'RuntimeServiceInput', 'ServiceLink', 'ServiceGraph', 'ServiceLinkInput', 'ServiceSettingsSchemaPreview', 'ToolchainStatus', 'TrafficRecordView', 'Workspace', 'WorkspaceState']
  const legacyFields = [
    'schemaVersion:string', 'timestamp:string', 'owner:string', 'code:string', 'severity:string', 'message:string', 'operationId:string', 'target:string',
    'ID:string', 'Version:string', 'Digest:string', 'Path:string', 'Enabled:boolean', 'Signed:boolean',
    'name:string', 'description:string', 'workspaceFeatures:string[]',
    'id:string', 'name:string', 'rootPath:string',
    'path:string', 'kind:string', 'bytes:number',
    'id:string', 'name:string', 'version:string', 'manifestVersion:string', 'servicePath:string', 'settingsPath:string', 'settingsSchemaPath:string', 'linkPaths:string[]', 'problemCount:number', 'configured:boolean', 'artifact?:ServiceArtifactReference',
    'id:string', 'name:string', 'version:string', 'manifestVersion:string', 'settingsSchemaPath:string',
    'responseSchemaPath:string', 'target:string', 'contractVersion:string', 'transport:string', 'sourcePath:string', 'requestSchemaPath:string', 'contractSchemaPath:string', 'caller:string', 'id:string', 'securityProfile:string', 'redactionPolicy:string', 'compatibility:string', 'disabledMethods:string[]', 'methods:string[]', 'timeoutMillis:number', 'responseLimitBytes:number', 'requestLimitBytes:number', 'retryLimit:number', 'valid:boolean',
    'services:RuntimeService[]', 'links:ServiceLink[]',
    'id:string', 'caller:string', 'target:string', 'contractVersion:string', 'methods:string[]', 'transport:string', 'requestSchemaPath:string', 'responseSchemaPath:string', 'contractSchemaPath:string', 'securityProfile:string', 'timeoutMillis:number', 'retryLimit:number', 'requestLimitBytes:number', 'responseLimitBytes:number', 'disabledMethods:string[]', 'compatibility:string', 'redactionPolicy:string',
    'schemaJson:string', 'schemaDigest:string', 'previousSchemaDigest:string', 'settingsDigest:string', 'draftDigest:string', 'migrationCandidateDigest:string', 'recoveryCopyPath:string', 'recoverySchemaCopyPath:string', 'migrationChangedPaths:string[]', 'migrationFromVersion:number', 'migrationToVersion:number', 'migrationRequired:boolean', 'valuesCompatible:boolean',
    'cliPath:string', 'cliVersion:string', 'errorCode:string', 'cliAvailable:boolean',
    'reportOperationId:string', 'reportTarget:string', 'reportCommitSha:string', 'timestamp:string', 'correlationId:string', 'caller:string', 'target:string', 'method:string', 'transport:string', 'status:string', 'schemaValidation:string', 'requestPayload:string', 'responsePayload:string', 'latencyMillis:number', 'requestSize:number', 'responseSize:number',
    'project?:Project', 'graph:ServiceGraph', 'files:ProjectFile[]',
    'projectId:string', 'layoutJson:string', 'tabsJson:string', 'filtersJson:string',
  ]
  const artifactFields = ['id:string', 'version:string', 'platform:string', 'digest:string', 'command?:string', 'manifest?:string', 'schema?:string', 'trusted:boolean']
  const reportSummaryFields = ['operationId:string', 'target:string', 'commitSha:string', 'generation:string', 'bundleDigest:string', 'cliVersion:string', 'coreApiCompatibility:string', 'importedAt:string', 'state:string', 'replicaCount:number', 'readyReplicas:number']
  const serviceArtifactFields = ['id:string', 'version:string', 'platform:string', 'digest:string']
  const projectFileEnd = legacyFields.findIndex((field, index) => field === 'path:string' && legacyFields[index + 1] === 'kind:string' && legacyFields[index + 2] === 'bytes:number') + 3
  const expectedFields = [
    ...artifactFields,
    ...legacyFields.slice(0, projectFileEnd),
    ...reportSummaryFields,
    ...serviceArtifactFields,
    ...legacyFields.slice(projectFileEnd),
  ]
  const expectedExports = ['namespace:models', ...expectedClasses.map((name) => `class:${name}`)]
  const current = source.startsWith('export namespace models {') && JSON.stringify(classes) === JSON.stringify(expectedClasses) && JSON.stringify(exports) === JSON.stringify(expectedExports) && JSON.stringify(fields) === JSON.stringify(expectedFields)
  if (!current) {
    throw new Error('Unsupported Wails model schema; update the Studio adapter and its tests')
  }
  return modelModule
}

export function prepareAppTypes(source: string): string {
  return source.replace(/import \{models\} from '\.\.\/models';/u, "import * as models from '../models';")
}

export function prepareRuntimeTypes(source: string): string {
  return source.replaceAll('...data: any', '...data: unknown[]')
    .replaceAll('[key: string]: any', '[key: string]: unknown')
}

export const transformations: readonly (readonly [string, (source: string) => string])[] = [
  ['go/models.ts', prepareModels],
  ['go/wails/App.d.ts', prepareAppTypes],
  ['runtime/runtime.d.ts', prepareRuntimeTypes],
]

export async function prepareBindings(root: string): Promise<void> {
  const prepared = await Promise.all(transformations.map(async ([name, prepare]) => {
    const path = resolve(root, name)
    const source = await readFile(path, 'utf8')
    return { path, source, result: prepare(source) }
  }))
  for (const { path, source, result } of prepared) {
    if (source !== result) await writeFile(path, result)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareBindings(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/wailsjs'))
}
