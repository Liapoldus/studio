import { ProductInfo } from '../../wailsjs/go/wails/App'
import { ProductInfo as ProductInfoData } from './info'
import type { StudioAPI } from './types'

export function createWailsStudioAPI(): StudioAPI {
  return {
    async productInfo() {
      return new ProductInfoData(await ProductInfo())
    },
  }
}
