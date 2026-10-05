import { createError, getHeader, type H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'

/**
 * Preserve the authenticated Gateway catalog byte-for-byte across service hops.
 * Reuse the route resolver's bound; never reconstruct or add destinations.
 * Any service hop to Console whose trusted context names another app (service tokens and the
 * OIDC code exchange alike) needs it: Console resolves its own policy binding from this catalog.
 */
export function forwardedServiceRouteCatalogHeader(event: H3Event): Record<string, string> {
  const catalog = getHeader(event, 'x-hzy-service-routes')
  if (catalog === undefined) return {}
  // Only a request that itself came through the verified tenant Gateway (shared token) may pass the catalog on.
  if (!resolveTrustedTenantGatewayContext(event, useRuntimeConfig(event) as unknown as Record<string, unknown>)) return {}
  let valid = catalog.length > 0 && catalog.length <= 16_384
  try {
    const value: unknown = JSON.parse(catalog)
    valid = valid && value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    valid = false
  }
  if (!valid) throw createError({ statusCode: 503, message: 'Trusted service route catalog is invalid' })
  return { 'x-hzy-service-routes': catalog }
}
