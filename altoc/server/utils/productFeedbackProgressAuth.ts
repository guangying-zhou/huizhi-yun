import { createError, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireAltocServiceAuth } from './serviceAuthGuard'

export async function requireProductFeedbackProgressAuth(event: H3Event) {
  const auth = await requireConsoleAuthContext(event)
  const scope = 'altoc:product-feedback:update-progress'
  requireAltocServiceAuth(auth, { scope, allowedApps: ['aims'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (!auth.scopes?.includes(scope) || auth.appCode !== 'aims' || auth.clientCode !== 'aims.runtime'
    || !auth.tenant || !auth.deployment || !gateway || gateway.appCode !== 'altoc'
    || gateway.tenant !== auth.tenant || !gateway.deployment) {
    throw createError({ statusCode: 403, message: 'Product feedback status service identity is invalid.' })
  }
  return { tenant: auth.tenant, sourceDeployment: auth.deployment, targetDeployment: gateway.deployment }
}
