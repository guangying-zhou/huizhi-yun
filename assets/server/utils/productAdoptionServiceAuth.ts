import { createError, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'

export const productAdoptionReadCapability = 'assets:product-adoption:read'

// This boundary is specific to the signed aims.assets.product-adoption.read.v1
// protocol. Console authentication verifies audience, expiry and revocation.
export async function requireProductAdoptionServiceAuth(event: H3Event) {
  const auth = await requireConsoleAuthContext(event)
  requireServiceScope(event, { scope: productAdoptionReadCapability })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'aims' || auth.clientCode !== 'aims.runtime'
    || !auth.tenant || !auth.deployment || !gateway
    || gateway.appCode !== 'assets' || gateway.tenant !== auth.tenant || !gateway.deployment) {
    throw createError({
      statusCode: 403,
      message: '产品采用查询的服务身份或部署绑定无效',
      data: { reason: 'product_adoption_service_identity_invalid' }
    })
  }
  return { tenant: auth.tenant, sourceDeployment: auth.deployment, targetDeployment: gateway.deployment }
}
