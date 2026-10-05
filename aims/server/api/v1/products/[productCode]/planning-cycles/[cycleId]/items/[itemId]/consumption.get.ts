import { createError, getQuery, getRouterParam, setHeader } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from '../../../../../../../../utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../../../../utils/productWorkspaceInput'
import { runtimeEnvelopeError } from '../../../../../../../../utils/aimsRuntimeForward'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const cycleId = getRouterParam(event, 'cycleId') || '', itemId = getRouterParam(event, 'itemId') || ''
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (Object.keys(getQuery(event)).length || !uuid.test(cycleId) || !uuid.test(itemId)) throw createError({ statusCode: 400, message: '投入确认查询条件无效' })
  const input = { cycle_biz_id: cycleId, item_biz_id: itemId }
  const facts = await requireProductPermission(event, code, 'product_priorities', 'view')
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/planning-consumption:view`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-priorities:read',
    query: { current_user: facts.actor_uid },
    body: { input, authorization: { resource: 'product_priorities', action: 'view', facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
})
