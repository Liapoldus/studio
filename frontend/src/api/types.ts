export interface ProductInfo {
  name: string
  description: string
  coreAccessModes: string[]
  singleCoreBinding: boolean
}

export interface StudioAPI {
  productInfo(): Promise<ProductInfo>
}
