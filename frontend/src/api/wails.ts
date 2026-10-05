import { ProductInfo } from '../../wailsjs/go/wails/App'
import type { StudioAPI } from './types'

export function createWailsStudioAPI(): StudioAPI {
  return {
    async productInfo() {
      const info = await ProductInfo()
      return {
        name: info.name,
        description: info.description,
        coreAccessModes: info.coreAccessModes,
        singleCoreBinding: false,
      }
    },
  }
}
