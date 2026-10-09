import { createError, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'

/** Service authentication is authoritative Console introspection, not inbound headers. */
export async function requireEnterpriseAimsServiceIngress(event: H3Event, family: 'callback' | 'notification') {
  const auth = await requireConsoleAuthContext(event)
  const source = family === 'callback' ? 'workflow' : 'console'
  const scope = family === 'callback' ? 'enterprise:workflow-callback:execute' : 'enterprise:notification-detail:authorize'
  const target = resolveTrustedTenantGatewayContext(event)
  const targetRoute = resolveTrustedServiceAppRoute(event, 'enterprise')
  const sourceRoute = resolveTrustedServiceAppRoute(event, source)
  if (auth.subjectType !== 'service' || auth.tokenUse !== 'service' || auth.appCode !== source || auth.clientCode !== `${source}.runtime`
    || !auth.scopes?.includes(scope) || !target || target.appCode !== 'enterprise' || target.tenant !== auth.tenant
    || !targetRoute || target.deployment !== targetRoute.deploymentCode
    || !sourceRoute || sourceRoute.deploymentCode !== auth.deployment) {
    throw createError({ statusCode: 403, message: 'Enterprise service source binding is invalid.' })
  }
  return auth
}
