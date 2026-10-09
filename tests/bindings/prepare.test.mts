import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { modelModule, prepareModels, prepareAppTypes, prepareRuntimeTypes, transformations } from '../../scripts/bindings/prepare.mts'

const generated = `export namespace models {
  export class ProductInfo {
    name: string;
    description: string;
    coreAccessModes: string[];
    singleCoreBinding: boolean;
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
