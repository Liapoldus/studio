import { ProductInfo } from './info'
import type { StudioAPI } from './types'

export function createHTTPStudioAPI(): StudioAPI {
  return {
    async productInfo() {
      const response = await fetch('/api/v1/product-info', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Не удалось загрузить состояние Studio')
      return new ProductInfo(await response.json())
    },
    async workspace() {
      const response = await fetch('/api/v1/workspace', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Не удалось загрузить дерево проекта')
      return response.json()
    },
  }
}
