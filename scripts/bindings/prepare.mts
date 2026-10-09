import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const modelModule = "// Prepared by scripts/bindings/prepare.mts.\nexport { ProductInfo, models } from '../../src/api/info'\n"

// Fail closed when the canonical Go model changes.
export function prepareModels(source: string): string {
  if (source === modelModule) return source
  const classes = [...source.matchAll(/export class (\w+)/gu)].map(match => match[1])
  const fields = [...source.matchAll(/^\s+(\w+): ([^;\n]+);$/gmu)]
    .map(match => `${match[1]}:${match[2]}`)
  const exports = [...source.matchAll(/\bexport (namespace|class|interface|enum|type) (\w+)/gu)]
    .map(match => `${match[1]}:${match[2]}`)
  if (!source.startsWith('export namespace models {') ||
    JSON.stringify(classes) !== JSON.stringify(['ProductInfo']) ||
    JSON.stringify(exports) !== JSON.stringify(['namespace:models', 'class:ProductInfo']) ||
    JSON.stringify(fields) !== JSON.stringify(['name:string', 'description:string', 'workspaceFeatures:string[]'])) {
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
