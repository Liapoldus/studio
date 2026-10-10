import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { modelModule, prepareModels, prepareAppTypes, prepareRuntimeTypes, transformations } from '../../scripts/bindings/prepare.mts'

const generated = `export namespace models {
  export class Diagnostic {
    schemaVersion: string;
    timestamp: string;
    owner: string;
    code: string;
    severity: string;
    message: string;
    operationId: string;
    target: string;
    constructor(source: any = {}) {}
  }
  export class GitBranch {
    name: string;
    remote: string;
    current: boolean;
    constructor(source: any = {}) {}
  }
  export class GitChange {
    path: string;
    indexStatus: string;
    worktreeStatus: string;
    constructor(source: any = {}) {}
  }
  export class GitCommit {
    hash: string;
    shortHash: string;
    author: string;
    timestamp: string;
    subject: string;
    constructor(source: any = {}) {}
  }
  export class GitDiff {
    path: string;
    patch: string;
    truncated: boolean;
    constructor(source: any = {}) {}
  }
  export class GitRemote {
    name: string;
    fetchUrl: string;
    pushUrl: string;
    constructor(source: any = {}) {}
  }
  export class GitStatus {
    branch: string;
    revision: string;
    changes: GitChange[];
    dirty: boolean;
    available: boolean;
    conflict: boolean;
    constructor(source: any = {}) {}
  }
  export class InstalledPluginState {
    ID: string;
    Version: string;
    Digest: string;
    Path: string;
    Enabled: boolean;
    Signed: boolean;
    constructor(source: any = {}) {}
  }
  export class PluginLink {
    responseSchemaPath: string;
    target: string;
    contractVersion: string;
    transport: string;
    sourcePath: string;
    requestSchemaPath: string;
    contractSchemaPath: string;
    caller: string;
    id: string;
    securityProfile: string;
    redactionPolicy: string;
    compatibility: string;
    disabledMethods: string[];
    methods: string[];
    timeoutMillis: number;
    responseLimitBytes: number;
    requestLimitBytes: number;
    retryLimit: number;
    valid: boolean;
    constructor(source: any = {}) {}
  }
  export class RuntimePlugin {
    id: string;
    name: string;
    version: string;
    manifestVersion: string;
    servicePath: string;
    settingsPath: string;
    settingsSchemaPath: string;
    linkPaths: string[];
    problemCount: number;
    configured: boolean;
    constructor(source: any = {}) {}
  }
  export class PluginGraph {
    plugins: RuntimePlugin[];
    links: PluginLink[];
    constructor(source: any = {}) {}
  }
  export class ProductInfo {
    name: string;
    description: string;
    workspaceFeatures: string[];
    constructor(source: any = {}) {}
  }
  export class Project {
    id: string;
    name: string;
    rootPath: string;
    constructor(source: any = {}) {}
  }
  export class ProjectFile {
    path: string;
    kind: string;
    bytes: number;
    constructor(source: any = {}) {}
  }
  export class TrafficRecordView {
    reportOperationId: string;
    reportTarget: string;
    reportCommitSha: string;
    timestamp: string;
    correlationId: string;
    caller: string;
    target: string;
    method: string;
    transport: string;
    status: string;
    schemaValidation: string;
    requestPayload: string;
    responsePayload: string;
    latencyMillis: number;
    requestSize: number;
    responseSize: number;
    constructor(source: any = {}) {}
  }
  export class Workspace {
    project?: Project;
    graph: PluginGraph;
    files: ProjectFile[];
    git: GitStatus;
    constructor(source: any = {}) {}
  }
  export class WorkspaceState {
    projectId: string;
    layoutJson: string;
    tabsJson: string;
    filtersJson: string;
    constructor(source: any = {}) {}
  }
}`

await test('Wails preparation is idempotent and rejects schema drift', () => {
  assert.equal(prepareModels(generated), modelModule)
  assert.equal(prepareModels(modelModule), modelModule)
  assert.throws(() => prepareModels(generated.replace('name: string;', 'name: number;')))
  assert.throws(() => prepareModels(generated.replace('constructor', 'extra: string;\nconstructor')))
  assert.throws(() => prepareModels(generated.replace('constructor', 'extra: number;\nconstructor')))
  assert.throws(() => prepareModels(`${generated}\nexport class Another {}`))
})

await test('declaration preparation preserves signatures and is idempotent', () => {
  const app = "import {models} from '../models';\nexport function ProductInfo():Promise<models.ProductInfo>;"
  const preparedApp = prepareAppTypes(app)
  assert.equal(preparedApp, "import * as models from '../models';\nexport function ProductInfo():Promise<models.ProductInfo>;")
  assert.equal(prepareAppTypes(preparedApp), preparedApp)
  const runtime = 'export function EventsEmit(name: string, ...data: any): void;\nexport interface Options { data?: { [key: string]: any }; }'
  const preparedRuntime = prepareRuntimeTypes(runtime)
  assert.equal(preparedRuntime, 'export function EventsEmit(name: string, ...data: unknown[]): void;\nexport interface Options { data?: { [key: string]: unknown }; }')
  assert.equal(prepareRuntimeTypes(preparedRuntime), preparedRuntime)
})

await test('checked-in bindings match the preparation pipeline', async () => {
  for (const [path, prepare] of transformations) {
    const source = await readFile(new URL(`../../frontend/wailsjs/${path}`, import.meta.url), 'utf8')
    assert.equal(prepare(source), source, `run npm run bindings:prepare for ${path}`)
  }
})
