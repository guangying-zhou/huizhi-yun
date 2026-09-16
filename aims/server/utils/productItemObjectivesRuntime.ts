import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productModelPageInput } from './productModelInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductItemObjectives(event: H3Event, itemId: string) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '只支持读取关联目标' })
  const code = getRouterParam(event, 'productCode') || ''
  const page = productModelPageInput(getQuery(event))
  if (!crossDependencyProductCode(code) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(itemId) || !page) throw createError({ statusCode: 400, message: '产品、事项或分页无效' })
  const objective = await requireProductPermission(event, code, 'product_objectives', 'view')
  const planning = await requireProductPermission(event, code, 'product_priorities', 'view')
  if (![objective, planning].every(facts => facts.product_code === code) || !(['actor_uid', 'revision', 'status', 'is_member', 'is_manager'] as const).every(key => objective[key] === planning[key])) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
  const expires = Date.now() + 15000
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/objectives:item-objectives`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-objectives:read', query: { current_user: objective.actor_uid },
    body: { input: { item_biz_id: itemId, ...page }, authorization: { resource: 'product_objectives', action: 'view', facts: objective, expires_at: expires }, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planning, expires_at: expires } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}
