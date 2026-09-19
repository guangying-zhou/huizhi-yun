import type { ProductAuthorizationSource } from './productAuthorization'

// Supplied only by a composing server; browser inputs never select transport.
export interface ProductCommandBridge {
  authorizationSource: ProductAuthorizationSource
  call(productCode: string, action: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<{ code: number, data: unknown }>
}
