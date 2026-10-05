import type { H3Event } from 'h3'
import type { fetchProductCatalog } from './productCatalog'
import type { fetchProductLineCatalog } from './productLineCatalog'

// Server-only composition dependency; no browser input chooses the transport.
export interface ProductOnboardBridge {
  catalog: typeof fetchProductCatalog
  lineCatalog: typeof fetchProductLineCatalog
  execute(event: H3Event, action: 'onboard' | 'onboard-line', productCode: string, input: Record<string, unknown>, authorization: Record<string, unknown>, directory: Record<string, unknown>, key: string): Promise<{ code: number, data: unknown }>
}
