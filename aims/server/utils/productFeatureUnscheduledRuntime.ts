import type { ProductCommandBridge } from './productCommandBridge'
import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productFeatureRequestPageInput } from './productFeatureRequestInput'
import { hasProductControlCharacter } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductFeatureUnscheduled(event: H3Event, bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const input = productFeatureRequestPageInput(getQuery(event), getRouterParam(event, 'featureId') || '')
  if (!input) throw createError({ statusCode: 400, message: '未排期事项查询条件无效' })
  const planningFacts = await requireProductPermission(event, code, 'product_priorities', 'view', bridge?.authorizationSource)
  const featureFacts = await requireProductPermission(event, code, 'product_features', 'view', bridge?.authorizationSource)
  const expires = Date.now() + 15000
  const runtime = bridge
    ? { handled: true as const, data: await bridge.call(code, 'unscheduled', { input, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planningFacts, expires_at: expires }, feature_authorization: { resource: 'product_features', action: 'view', facts: featureFacts, expires_at: expires } }) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/feature-unscheduled:view`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-priorities:read', query: { current_user: planningFacts.actor_uid },
        body: { input, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planningFacts, expires_at: expires }, feature_authorization: { resource: 'product_features', action: 'view', facts: featureFacts, expires_at: expires } }
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
