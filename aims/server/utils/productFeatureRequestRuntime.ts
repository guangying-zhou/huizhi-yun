import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productFeatureRequestChangeInput, productFeatureRequestPageInput } from './productFeatureRequestInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductFeatureRequests(event: H3Event, action: 'list' | 'change') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const featureId = getRouterParam(event, 'featureId') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const key = action === 'change' ? productCommandKey(getHeader(event, 'Idempotency-Key')) : undefined
  const input = action === 'list' ? productFeatureRequestPageInput(getQuery(event), featureId) : productFeatureRequestChangeInput(await readBody(event), featureId)
  if (!input || (action === 'change' && !key)) throw createError({ statusCode: 400, message: '功能需求关联参数或幂等键无效' })
  const requestAction = action === 'list' ? 'view' : 'edit'
  const requestFacts = await requireProductPermission(event, code, 'product_requests', requestAction)
  const featureFacts = await requireProductPermission(event, code, 'product_features', 'view')
  const expires = Date.now() + 15000
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/feature-requests:${action}`, {
    appCode: 'aims', method: 'POST', scope: action === 'list' ? 'aims.read aims:product-features:read' : 'aims.write aims:product-features:request-link',
    query: { current_user: requestFacts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, request_authorization: { resource: 'product_requests', action: requestAction, facts: requestFacts, expires_at: expires }, feature_authorization: { resource: 'product_features', action: 'view', facts: featureFacts, expires_at: expires } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
