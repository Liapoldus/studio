export interface ProductInfo {
  name: string
  description: string
  workspaceFeatures: string[]
}

export interface StudioAPI {
  productInfo(): Promise<ProductInfo>
}
