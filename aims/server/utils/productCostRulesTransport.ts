import { createError, type H3Event } from 'h3'
import { buildServiceCommandRuntimeHeaders, type SignedServiceCommandEnvelope } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import type { ClaimedDeliveryOperation } from './serviceTicketDeliveryOperationExecutor'

type Row = Record<string, unknown>
export async function sendProductCostRules(event: H3Event | null, operation: ClaimedDeliveryOperation, envelope: Row, targetDeploymentOverride = ''): Promise<Row> {
  const tenantCode = String(operation.tenantCode || '')
  const sourceDeploymentCode = String(operation.deploymentCode || '')
  const gateway = event ? resolveTrustedTenantGatewayContext(event) : null
  const route = event ? resolveTrustedServiceAppRoute(event, 'finance') : null
  if (event && (!gateway || !route || gateway.tenant !== tenantCode || gateway.deployment !== sourceDeploymentCode || gateway.appCode !== 'aims')) {
    throw createError({ statusCode: 503, message: 'Product cost rules trusted route is unavailable.' })
  }
  const targetDeploymentCode = route?.deploymentCode || targetDeploymentOverride
  const base = route?.baseUrl || resolveServiceAppBaseUrl(event, 'finance')
  if (!base || !tenantCode || !sourceDeploymentCode || !targetDeploymentCode) throw createError({ statusCode: 503, message: 'Product cost rules deployment binding is unavailable.' })
  const url = `${base.replace(/\/+$/, '')}/api/v1/finance/service/product-cost/replace-rules`
  return await requestWithServiceAccessToken({ audience: 'finance', scope: 'finance:product-cost:replace-rules', event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({
      token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId,
      tenantCode, sourceDeploymentCode, targetDeploymentCode, sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'finance',
      envelope: envelope.serviceCommand as SignedServiceCommandEnvelope
    })
    const response = await serviceAppFetch<{ code: number, data: Row }>(event, 'finance', url, {
      method: 'POST', body: envelope, timeout: 15000,
      headers: {
        'x-hzy-tenant': tenantCode, 'x-hzy-deployment': targetDeploymentCode, 'x-hzy-app-code': 'finance',
        'idempotency-key': String(operation.idempotencyKey), 'x-request-id': requestId,
        ...signed, 'authorization': `Bearer ${token}`, 'content-type': 'application/json'
      }
    })
    if (response?.code !== 0 || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) throw createError({ statusCode: 502, message: 'Product cost rules target response is invalid.' })
    return response.data
  } })
}
