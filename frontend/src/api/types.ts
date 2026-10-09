export interface ProductInfo {
  name: string
  description: string
  workspaceFeatures: string[]
}

export interface StudioAPI {
  productInfo(): Promise<ProductInfo>
  workspace(): Promise<Workspace>
}

export interface Workspace {
  project: { name: string } | null
  files: Array<{ path: string; kind: string; bytes?: number }>
}
