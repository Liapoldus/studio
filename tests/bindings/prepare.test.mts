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
  export class InstalledStudioPluginState {
    ID: string;
    Version: string;
    Digest: string;
    Path: string;
    Enabled: boolean;
    Signed: boolean;
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
  export class RuntimeService {
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
  export class RuntimeServiceInput {
    id: string;
    name: string;
    version: string;
    manifestVersion: string;
    settingsSchemaPath: string;
    constructor(source: any = {}) {}
  }
  export class ServiceLink {
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
  export class ServiceGraph {
    services: RuntimeService[];
    links: ServiceLink[];
    constructor(source: any = {}) {}
  }
  export class ServiceLinkInput {
    id: string;
    caller: string;
    target: string;
    contractVersion: string;
    methods: string[];
    transport: string;
    requestSchemaPath: string;
    responseSchemaPath: string;
    contractSchemaPath: string;
    securityProfile: string;
    timeoutMillis: number;
    retryLimit: number;
    requestLimitBytes: number;
    responseLimitBytes: number;
    disabledMethods: string[];
    compatibility: string;
    redactionPolicy: string;
    constructor(source: any = {}) {}
  }
  export class ServiceSettingsSchemaPreview {
    schemaJson: string;
    schemaDigest: string;
    previousSchemaDigest: string;
    settingsDigest: string;
    draftDigest: string;
    migrationCandidateDigest: string;
    recoveryCopyPath: string;
    recoverySchemaCopyPath: string;
    migrationChangedPaths: string[];
    migrationFromVersion: number;
    migrationToVersion: number;
    migrationRequired: boolean;
    valuesCompatible: boolean;
    constructor(source: any = {}) {}
  }
  export class ToolchainStatus {
    cliPath: string;
    cliVersion: string;
    errorCode: string;
    cliAvailable: boolean;
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
    graph: ServiceGraph;
    files: ProjectFile[];
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
  assert.throws(() => prepareModels(generated), /Unsupported Wails model schema/u)
  assert.equal(prepareModels(modelModule), modelModule)
  assert.throws(() => prepareModels(generated.replace('name: string;', 'name: number;')))
  assert.throws(() => prepareModels(generated.replace('constructor', 'extra: string;\nconstructor')))
  assert.throws(() => prepareModels(generated.replace('constructor', 'extra: number;\nconstructor')))
  assert.throws(() => prepareModels(`${generated}\nexport class Another {}`))
})

await test('Wails preparation accepts only the complete current model schema', () => {
  const current = generated
    .replace('export namespace models {', `export namespace models {
  export class ArtifactReference {
    id: string;
    version: string;
    platform: string;
    digest: string;
    command?: string;
    manifest?: string;
    schema?: string;
    trusted: boolean;
    constructor(source: any = {}) {}
  }`)
    .replace('  export class RuntimeService {', `  export class ReportSummary {
    operationId: string;
    target: string;
    commitSha: string;
    generation: string;
    bundleDigest: string;
    cliVersion: string;
    coreApiCompatibility: string;
    importedAt: string;
    state: string;
    replicaCount: number;
    readyReplicas: number;
    constructor(source: any = {}) {}
  }
  export class ServiceArtifactReference {
    id: string;
    version: string;
    platform: string;
    digest: string;
    constructor(source: any = {}) {}
  }
  export class RuntimeService {`)
    .replace('    configured: boolean;\n    constructor(source: any = {}) {}\n  }', '    configured: boolean;\n    artifact?: ServiceArtifactReference;\n    constructor(source: any = {}) {}\n  }')
  assert.equal(prepareModels(current), modelModule)
  assert.throws(() => prepareModels(current.replace('importedAt: string;', 'importedAt: number;')))
  assert.throws(() => prepareModels(current.replace('schema?: string;', 'schema?: number;')))
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
