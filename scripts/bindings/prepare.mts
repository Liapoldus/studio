import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const modelModule = "// Prepared by scripts/bindings/prepare.mts.\nexport { Diagnostic, GitBranch, GitChange, GitCommit, GitDiff, GitRemote, GitStatus, InstalledPluginState, PluginGraph, PluginLink, ProductInfo, Project, ProjectFile, RuntimePlugin, TrafficRecordView, Workspace, WorkspaceState, models } from '../../src/api/info'\n"

// Fail closed when the canonical Go model changes.
export function prepareModels(source: string): string {
  if (source === modelModule) return source
  const classes = [...source.matchAll(/export class (\w+)/gu)].map(match => match[1])
  const fields = [...source.matchAll(/^\s+(\w+): ([^;\n]+);$/gmu)]
    .map(match => `${match[1]}:${match[2]}`)
  const exports = [...source.matchAll(/\bexport (namespace|class|interface|enum|type) (\w+)/gu)]
    .map(match => `${match[1]}:${match[2]}`)
  const expectedClasses = ['Diagnostic', 'GitBranch', 'GitChange', 'GitCommit', 'GitDiff', 'GitRemote', 'GitStatus', 'InstalledPluginState', 'PluginLink', 'RuntimePlugin', 'PluginGraph', 'ProductInfo', 'Project', 'ProjectFile', 'TrafficRecordView', 'Workspace', 'WorkspaceState']
  const expectedFields = [
    'schemaVersion:string', 'timestamp:string', 'owner:string', 'code:string', 'severity:string', 'message:string', 'operationId:string', 'target:string',
    'name:string', 'remote:string', 'current:boolean',
    'path:string', 'indexStatus:string', 'worktreeStatus:string',
    'hash:string', 'shortHash:string', 'author:string', 'timestamp:string', 'subject:string',
    'path:string', 'patch:string', 'truncated:boolean',
    'name:string', 'fetchUrl:string', 'pushUrl:string',
    'branch:string', 'revision:string', 'changes:GitChange[]', 'dirty:boolean', 'available:boolean', 'conflict:boolean',
    'ID:string', 'Version:string', 'Digest:string', 'Path:string', 'Enabled:boolean', 'Signed:boolean',
    'responseSchemaPath:string', 'target:string', 'contractVersion:string', 'transport:string', 'sourcePath:string', 'requestSchemaPath:string', 'contractSchemaPath:string', 'caller:string', 'id:string', 'securityProfile:string', 'redactionPolicy:string', 'compatibility:string', 'disabledMethods:string[]', 'methods:string[]', 'timeoutMillis:number', 'responseLimitBytes:number', 'requestLimitBytes:number', 'retryLimit:number', 'valid:boolean',
    'id:string', 'name:string', 'version:string', 'manifestVersion:string', 'servicePath:string', 'settingsPath:string', 'settingsSchemaPath:string', 'linkPaths:string[]', 'problemCount:number', 'configured:boolean',
    'plugins:RuntimePlugin[]', 'links:PluginLink[]',
    'name:string', 'description:string', 'workspaceFeatures:string[]',
    'id:string', 'name:string', 'rootPath:string',
    'path:string', 'kind:string', 'bytes:number',
    'reportOperationId:string', 'reportTarget:string', 'reportCommitSha:string', 'timestamp:string', 'correlationId:string', 'caller:string', 'target:string', 'method:string', 'transport:string', 'status:string', 'schemaValidation:string', 'requestPayload:string', 'responsePayload:string', 'latencyMillis:number', 'requestSize:number', 'responseSize:number',
    'graph:PluginGraph', 'files:ProjectFile[]', 'git:GitStatus',
    'projectId:string', 'layoutJson:string', 'tabsJson:string', 'filtersJson:string',
  ]
  const expectedExports = ['namespace:models', ...expectedClasses.map((name) => `class:${name}`)]
  if (!source.startsWith('export namespace models {') ||
    JSON.stringify(classes) !== JSON.stringify(expectedClasses) ||
    JSON.stringify(exports) !== JSON.stringify(expectedExports) ||
    JSON.stringify(fields) !== JSON.stringify(expectedFields)) {
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
