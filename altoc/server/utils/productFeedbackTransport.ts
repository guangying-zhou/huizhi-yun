import { createError, type H3Event } from 'h3'
import { buildServiceCommandRuntimeHeaders, type SignedServiceCommandEnvelope } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import type { ClaimedOpsKnowledgeOperation } from './serviceTicketOpsKnowledgeOperation'

type Row = Record<string, unknown>
export async function sendProductFeedback(event: H3Event | null, operation: ClaimedOpsKnowledgeOperation, envelope: Row, targetDeploymentOverride = ''): Promise<Row> {
  const tenantCode = String(operation.tenantCode || '')
  const sourceDeploymentCode = String(operation.deploymentCode || '')
  const gateway = event ? resolveTrustedTenantGatewayContext(event) : null
  const route = event ? resolveTrustedServiceAppRoute(event, 'aims') : null
  if (event && (!gateway || !route || gateway.tenant !== tenantCode || gateway.deployment !== sourceDeploymentCode || gateway.appCode !== 'altoc')) {
    throw createError({ statusCode: 503, message: 'Feedback trusted route is unavailable.' })
  }
  const targetDeploymentCode = route?.deploymentCode || targetDeploymentOverride
  const base = resolveServiceAppBaseUrl(event, 'aims')
  if (!base || !tenantCode || !sourceDeploymentCode || !targetDeploymentCode) throw createError({ statusCode: 503, message: 'Feedback deployment binding is unavailable.' })
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/product-requests/from-feedback`
  return await requestWithServiceAccessToken({ audience: 'aims', scope: 'aims:product-request:create-from-feedback', event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({
      token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId,
      tenantCode, sourceDeploymentCode, targetDeploymentCode, sourceApp: 'altoc', sourceClientId: 'altoc.runtime', targetApp: 'aims',
      envelope: envelope.serviceCommand as SignedServiceCommandEnvelope
    })
    const response = await serviceAppFetch<{ code: number, data: Row }>(event, 'aims', url, {
      method: 'POST', body: envelope, timeout: 15000,
      headers: {
        'x-hzy-tenant': tenantCode, 'x-hzy-deployment': targetDeploymentCode, 'x-hzy-app-code': 'aims',
        'idempotency-key': String(operation.idempotencyKey), 'x-request-id': requestId,
        ...signed, 'authorization': `Bearer ${token}`, 'content-type': 'application/json'
      }
    })
    if (response.code !== 0 || !response.data) throw createError({ statusCode: 502, message: 'Feedback target response is invalid.' })
    return response.data
  } })
}
