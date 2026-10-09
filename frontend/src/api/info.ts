import type { ProductInfo as ProductInfoData } from './types'

// Wails generates unchecked constructors. This Studio-owned boundary keeps its
// exported models.ProductInfo factory while validating incoming values.
export class ProductInfo implements ProductInfoData {
  name: string
  description: string
  workspaceFeatures: string[]

  static createFrom(source: unknown = {}): ProductInfo {
    return new ProductInfo(source)
  }

  constructor(source: unknown = {}) {
    const value: unknown = typeof source === 'string' ? JSON.parse(source) : source
    if (typeof value !== 'object' || value === null ||
      !('name' in value) || typeof value.name !== 'string' ||
      !('description' in value) || typeof value.description !== 'string' ||
      !('workspaceFeatures' in value) || !Array.isArray(value.workspaceFeatures) ||
      !value.workspaceFeatures.every((feature: unknown) => typeof feature === 'string')) {
      throw new Error('Invalid Studio product information')
    }
    this.name = value.name
    this.description = value.description
    this.workspaceFeatures = [...value.workspaceFeatures]
  }
}

export const models = { ProductInfo }
