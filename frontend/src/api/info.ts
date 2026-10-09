import type { ProductInfo as ProductInfoData } from './types'

// Wails generates unchecked constructors. This Studio-owned boundary keeps its
// exported models.ProductInfo factory while validating incoming values.
export class ProductInfo implements ProductInfoData {
  name: string
  description: string
  coreAccessModes: string[]
  singleCoreBinding: boolean

  static createFrom(source: unknown = {}): ProductInfo {
    return new ProductInfo(source)
  }

  constructor(source: unknown = {}) {
    const value: unknown = typeof source === 'string' ? JSON.parse(source) : source
    if (typeof value !== 'object' || value === null ||
      !('name' in value) || typeof value.name !== 'string' ||
      !('description' in value) || typeof value.description !== 'string' ||
      !('coreAccessModes' in value) || !Array.isArray(value.coreAccessModes) ||
      !value.coreAccessModes.every((mode: unknown) => typeof mode === 'string') ||
      !('singleCoreBinding' in value) || typeof value.singleCoreBinding !== 'boolean') {
      throw new Error('Invalid Studio product information')
    }
    this.name = value.name
    this.description = value.description
    this.coreAccessModes = [...value.coreAccessModes]
    this.singleCoreBinding = value.singleCoreBinding
  }
}

export const models = { ProductInfo }
