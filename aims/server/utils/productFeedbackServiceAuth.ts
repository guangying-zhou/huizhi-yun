import { createError, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'

export async function requireProductFeedbackServiceAuth(event: H3Event) {
  const auth = await requireConsoleAuthContext(event)
  requireServiceScope(event, { scope: 'aims:product-request:create-from-feedback', allowedApps: ['altoc'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'altoc' || auth.clientCode !== 'altoc.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '反馈服务来源或目标部署绑定无效' })
  return { tenant: auth.tenant, sourceDeployment: auth.deployment, targetDeployment: gateway.deployment }
}
