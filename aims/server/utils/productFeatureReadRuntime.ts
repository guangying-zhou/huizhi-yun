import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productFeaturePageInput } from './productFeatureInput'
import { hasProductControlCharacter } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductFeatureRead(event: H3Event, action: 'list' | 'view') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const id = getRouterParam(event, 'featureId') || ''
  const query = getQuery(event)
  const input = action === 'list'
    ? productFeaturePageInput(query)
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) && Object.keys(query).length === 0 ? { biz_id: id } : null
  if (!input) throw createError({ statusCode: 400, message: '功能查询条件无效' })
  const facts = await requireProductPermission(event, code, 'product_features', 'view')
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/features:${action}`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-features:read',
    query: { current_user: facts.actor_uid },
    body: { input, authorization: { resource: 'product_features', action: 'view', facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
