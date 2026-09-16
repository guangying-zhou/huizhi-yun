import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productPlanningFeatureInput } from './productPlanningFeatureInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductPlanningFeature(event: H3Event, action: 'view' | 'change') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const itemId = getRouterParam(event, 'itemId') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const key = action === 'change' ? productCommandKey(getHeader(event, 'Idempotency-Key')) : undefined
  const input = action === 'view' ? (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(itemId) && Object.keys(getQuery(event)).length === 0 ? { item_biz_id: itemId } : null) : productPlanningFeatureInput(await readBody(event), itemId)
  if (!input || (action === 'change' && !key)) throw createError({ statusCode: 400, message: '规划功能关联参数或幂等键无效' })
  const planningAction = action === 'view' ? 'view' : 'edit'
  const planningFacts = await requireProductPermission(event, code, 'product_priorities', planningAction)
  const featureFacts = await requireProductPermission(event, code, 'product_features', 'view')
  const expires = Date.now() + 15000
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/planning-feature:${action}`, {
    appCode: 'aims', method: 'POST', scope: action === 'view' ? 'aims.read aims:product-priorities:read' : 'aims.write aims:product-priorities:feature-link',
    query: { current_user: planningFacts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, planning_authorization: { resource: 'product_priorities', action: planningAction, facts: planningFacts, expires_at: expires }, feature_authorization: { resource: 'product_features', action: 'view', facts: featureFacts, expires_at: expires } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
