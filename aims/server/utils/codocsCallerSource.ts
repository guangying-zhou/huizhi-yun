import { createError, type H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'

// Choose the signature source from the already authenticated transport, never
// from a browser payload or a caller-supplied service context. The owning Host
// cores separately require a verified Enterprise user before making a request.
export function codocsCallerSource(event?: H3Event): 'aims' | 'enterprise' {
  const gateway = event && resolveTrustedTenantGatewayContext(event)
  if (!gateway || gateway.appCode === 'aims') return 'aims'
  if (gateway.appCode === 'enterprise') return 'enterprise'
  throw createError({ statusCode: 403, message: '文档服务来源不匹配' })
}
