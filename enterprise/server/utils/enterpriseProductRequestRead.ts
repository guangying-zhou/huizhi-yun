import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { requireEnterpriseProductPermission } from './enterpriseProductAuthorization'
import { productRequestPageInput } from '../../../aims/server/utils/productRequestInput'
import { hasProductControlCharacter } from '../../../aims/server/utils/productWorkspaceInput'

export async function readEnterpriseProductRequests(event: H3Event, detail: boolean) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const query = getQuery(event)
  const id = getRouterParam(event, 'requestId') || ''
  const input = detail
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) && !Object.keys(query).length ? { bizId: id } : null
    : productRequestPageInput(query)
  if (!input) throw createError({ statusCode: 400, message: '需求查询条件无效' })
  const { user, authorization } = await requireEnterpriseProductPermission(event, code, 'view')
  const result = await callEnterpriseRuntime<{ code: number, data: unknown }>(event, detail ? 'aims.product-request-view' : 'aims.product-request-list', {
    productCode: code, tenant: user.tenant, deployment: user.deployment, authorization,
    ...(detail ? input : { query: input })
  })
  if (result.code !== 0) throw createError({ statusCode: 503, message: '需求查询服务暂不可用' })
  return result
}
