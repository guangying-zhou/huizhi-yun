import { createError, getHeader, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { ProductCommandBridge } from './productCommandBridge'
import { requireProductPermission } from './productAuthorization'
import { productRequestCreateInput } from './productRequestInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductRequestCreate(event: H3Event, bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  const input = productRequestCreateInput(await readBody(event))
  if (!key || !input) throw createError({ statusCode: 400, message: '需求字段或幂等键无效' })
  const facts = await requireProductPermission(event, code, 'product_requests', 'create', bridge?.authorizationSource)
  const body = { input, authorization: { resource: 'product_requests', action: 'create', facts, expires_at: Date.now() + 15000 } }
  const runtime = bridge
    ? { handled: true as const, data: await bridge.call(code, 'create', body, key) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/requests:create`, {
        appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-requests:create',
        query: { current_user: facts.actor_uid }, idempotencyKey: key, body
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
