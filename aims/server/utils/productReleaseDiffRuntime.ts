import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productReleaseDiffInput } from './productReleaseDiffInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductReleaseDiff(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '只支持读取发布对比' })
  const code = getRouterParam(event, 'productCode') || ''
  const input = productReleaseDiffInput(getQuery(event))
  if (!crossDependencyProductCode(code) || !input) throw createError({ statusCode: 400, message: '发布对比参数无效' })
  const facts = await requireProductPermission(event, code, 'product_versions', 'view')
  if (facts.product_code !== code) throw createError({ statusCode: 409, message: '产品授权上下文已变化' })
  const expires = Date.now() + 15000
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:release-diff`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-versions:read', query: { current_user: facts.actor_uid },
    body: { input, authorization: { resource: 'product_versions', action: 'view', facts, expires_at: expires } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}
