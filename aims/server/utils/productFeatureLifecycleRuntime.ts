import type { ProductCommandBridge } from './productCommandBridge'
import { createError, getHeader, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productFeatureLifecycleInput } from './productFeatureLifecycleInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductFeatureLifecycle(event: H3Event, bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  const input = productFeatureLifecycleInput(await readBody(event), getRouterParam(event, 'featureId') || '')
  if (!key || !input) throw createError({ statusCode: 400, message: '功能字段或幂等键无效' })
  const facts = await requireProductPermission(event, code, 'product_features', 'edit', bridge?.authorizationSource)
  if (!facts.is_manager) throw createError({ statusCode: 403, message: '生命周期变更需产品负责人确认' })
  const runtime = bridge
    ? { handled: true as const, data: await bridge.call(code, 'lifecycle', { input, authorization: { resource: 'product_features', action: 'edit', facts, expires_at: Date.now() + 15000 } }, key) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/features:lifecycle`, {
        appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-features:lifecycle',
        query: { current_user: facts.actor_uid }, idempotencyKey: key,
        body: { input, authorization: { resource: 'product_features', action: 'edit', facts, expires_at: Date.now() + 15000 } }
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
