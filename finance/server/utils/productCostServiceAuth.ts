import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireFinanceServiceCapability } from './serviceAuth'

export const productCostReadCapability = 'finance:product-cost:read'
export const productCostRulesReadCapability = 'finance:product-cost:read-rules'
export const productCostRulesCapability = 'finance:product-cost:replace-rules'

export async function requireProductCostServiceAuth(event: H3Event) {
  return requireProductCostIdentity(event, productCostReadCapability)
}

export async function requireProductCostRulesServiceAuth(event: H3Event) {
  return requireProductCostIdentity(event, productCostRulesCapability)
}

export async function requireProductCostRulesReadServiceAuth(event: H3Event) {
  return requireProductCostIdentity(event, productCostRulesReadCapability)
}

async function requireProductCostIdentity(event: H3Event, scope: string) {
  const auth = await resolveConsoleAuthContext(event)
  requireFinanceServiceCapability(auth, { scope, allowedApps: ['aims'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'aims' || auth.clientCode !== 'aims.runtime'
    || !auth.tenant || !auth.deployment || !gateway
    || gateway.appCode !== 'finance' || gateway.tenant !== auth.tenant || !gateway.deployment) {
    throw createError({ statusCode: 403, message: '产品成本查询的服务身份或部署绑定无效' })
  }
  return { tenant: auth.tenant, sourceDeployment: auth.deployment, targetDeployment: gateway.deployment }
}
