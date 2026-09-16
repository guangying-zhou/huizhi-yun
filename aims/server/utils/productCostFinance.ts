import { createError, getHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { parseProductCostResponse } from './productCostResponse'

export async function readProductCostFromFinance(event: H3Event, productCode: string, projectCode: string, periodMonth: string) {
  if (!crossDependencyProductCode(productCode) || !crossDependencyProductCode(projectCode) || [...projectCode].length > 50
    || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(periodMonth) || periodMonth.startsWith('0000')) throw createError({ statusCode: 400, message: '产品成本查询参数无效' })
  const facts = await requireProductPermission(event, productCode, 'products', 'view')
  if (facts.product_code !== productCode || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'finance')
  if (!gateway?.tenant || !gateway.deployment || gateway.appCode !== 'aims' || !route?.deploymentCode) {
    throw createError({ statusCode: 503, message: 'Finance 可信服务路由不可用' })
  }
  const command = { actorUid: facts.actor_uid, productCode, action: 'read', projectCode, periodMonth }
  const operationId = crypto.randomUUID()
  const serviceCommand = {
    operationId, targetApp: 'finance', operationCode: 'aims.finance.product-cost.read.v1',
    requiredCapability: 'finance:product-cost:read', idempotencyKey: `aims:product-cost:${operationId}`,
    commandSchemaVersion: 'aims.finance.product-cost.read.v1', commandSha256: await hashServiceCommandPayload(command), command
  }
  const url = `${route.baseUrl.replace(/\/+$/, '')}/api/v1/finance/service/product-cost/read`
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  const token = await requestServiceAccessToken({ event, audience: 'finance', scope: serviceCommand.requiredCapability })
  const signed = await buildServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: new URL(url).pathname, requestId,
    tenantCode: gateway.tenant, sourceDeploymentCode: gateway.deployment, targetDeploymentCode: route.deploymentCode,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'finance', envelope: serviceCommand
  })
  const result = await serviceAppFetch<{ code: number, data: Record<string, unknown> }>(event, 'finance', url, {
    method: 'POST', timeout: 20000,
    headers: { ...trustedServiceRequestHeaders(event, 'finance'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, ...signed },
    body: { serviceCommand }
  })
  const data = parseProductCostResponse(result?.data, productCode, projectCode, periodMonth)
  if (result?.code !== 0 || !data) {
    throw createError({ statusCode: 503, message: '产品成本服务响应无效' })
  }
  return data
}
