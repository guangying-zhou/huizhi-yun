import { createError, getHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { parseProductAdoptionResponse } from './productAdoptionResponse'
import { productAdoptionServiceFailure, productAdoptionTokenFailure, productAdoptionUpstreamStatus } from './productAdoptionFailure'

export async function readProductAdoptionFromAssets(event: H3Event, productCode: string, page: number, pageSize: number) {
  if (!crossDependencyProductCode(productCode) || !Number.isSafeInteger(page) || page < 1 || page > 1000000
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) throw createError({ statusCode: 400, message: '产品采用查询参数无效' })
  const facts = await requireProductPermission(event, productCode, 'products', 'view')
  if (facts.product_code !== productCode || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'assets')
  if (!gateway?.tenant || !gateway.deployment || gateway.appCode !== 'aims' || !route?.deploymentCode) {
    throw createError({ statusCode: 503, message: 'Assets 可信服务路由不可用' })
  }
  const command = { actorUid: facts.actor_uid, productCode, action: 'read', page, pageSize }
  const operationId = crypto.randomUUID()
  const serviceCommand = {
    operationId, targetApp: 'assets', operationCode: 'aims.assets.product-adoption.read.v1',
    requiredCapability: 'assets:product-adoption:read', idempotencyKey: `aims:product-adoption:${operationId}`,
    commandSchemaVersion: 'aims.assets.product-adoption.read.v1', commandSha256: await hashServiceCommandPayload(command), command
  }
  const url = `${route.baseUrl.replace(/\/+$/, '')}/api/v1/service/product-adoption/read`
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  // 令牌签发失败会带回 Console 的状态码与诊断串。它既不是这位用户的权限问题，
  // 也不该把内部诊断透出到浏览器，统一收敛为可重试的 503。
  let token: string
  try {
    token = await requestServiceAccessToken({ event, audience: 'assets', scope: serviceCommand.requiredCapability })
  } catch (cause) {
    console.error('[productAdoption] Assets service token unavailable:', {
      productCode, audience: 'assets', scope: serviceCommand.requiredCapability,
      statusCode: productAdoptionUpstreamStatus(cause)
    })
    throw createError(productAdoptionTokenFailure())
  }
  const signed = await buildServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: new URL(url).pathname, requestId,
    tenantCode: gateway.tenant, sourceDeploymentCode: gateway.deployment, targetDeploymentCode: route.deploymentCode,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'assets', envelope: serviceCommand
  })
  let result: { code: number, data: Record<string, unknown> }
  try {
    result = await serviceAppFetch<{ code: number, data: Record<string, unknown> }>(event, 'assets', url, {
      method: 'POST', timeout: 20000,
      headers: { ...trustedServiceRequestHeaders(event, 'assets'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, ...signed },
      body: { serviceCommand }
    })
  } catch (cause) {
    throw createError(productAdoptionServiceFailure(cause))
  }
  const data = parseProductAdoptionResponse(result?.data, productCode, page, pageSize)
  if (result?.code !== 0 || !data) {
    throw createError(productAdoptionServiceFailure(null))
  }
  return data
}
