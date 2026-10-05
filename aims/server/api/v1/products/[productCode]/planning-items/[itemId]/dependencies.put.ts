import { createError, getHeader, getRouterParam, readBody, setHeader } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from '../../../../../../utils/productAuthorization'
import { productDependencyEditInput } from '../../../../../../utils/productDependencyInput'
import { hasProductControlCharacter, productCommandKey } from '../../../../../../utils/productWorkspaceInput'
import { runtimeEnvelopeError } from '../../../../../../utils/aimsRuntimeForward'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  const input = productDependencyEditInput(await readBody(event), getRouterParam(event, 'itemId') || '')
  if (!key || !input) throw createError({ statusCode: 400, message: '依赖集合、版本、说明或幂等键无效' })
  const facts = await requireProductPermission(event, code, 'product_priorities', 'edit')
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/planning-dependencies:edit`, {
    appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-priorities:edit',
    query: { current_user: facts.actor_uid }, idempotencyKey: key,
    body: { input, authorization: { resource: 'product_priorities', action: 'edit', facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
})
