import type { ProductInfo, StudioAPI } from './types'

export function createHTTPStudioAPI(): StudioAPI {
  return {
    async productInfo() {
      const response = await fetch('/api/v1/product-info', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Не удалось загрузить состояние Studio')
      return (await response.json()) as ProductInfo
    },
  }
}
