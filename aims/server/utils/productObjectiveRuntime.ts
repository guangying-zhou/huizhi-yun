import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productObjectivePageInput, productObjectiveCreateInput, productObjectiveActionInput, productObjectiveObservationPageInput, type ProductObjectiveAction } from './productObjectiveInput'
import { productVersionID } from './productVersionInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { productObjectivePermissions } from './productObjectivePermissions'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductObjective(event: H3Event, action: 'list' | 'view' | 'create' | 'cycles' | 'items' | 'observations' | 'permissions' | ProductObjectiveAction, objectiveID?: string) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || !code.isWellFormed() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  if (action === 'permissions') {
    if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '权限请求不接受查询参数' })
    return productObjectivePermissions(event, code)
  }
  const reading = action === 'list' || action === 'view' || action === 'observations' || action === 'items' || action === 'cycles'
  const id = action !== 'list' && action !== 'create' ? productVersionID(objectiveID ?? getRouterParam(event, 'objectiveId')) : undefined
  if (id === null) throw createError({ statusCode: 400, message: '目标标识无效' })
  const key = reading ? undefined : productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!reading && (!key || Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400, message: '目标请求无效' })
  const input = action === 'observations' || action === 'items' || action === 'cycles' ? productObjectiveObservationPageInput(getQuery(event), id!) : action === 'view' ? (Object.keys(getQuery(event)).length ? null : { id }) : action === 'list' ? productObjectivePageInput(getQuery(event)) : action === 'create' ? productObjectiveCreateInput(await readBody(event)) : productObjectiveActionInput(await readBody(event), id!, action)
  if (!input) throw createError({ statusCode: 400, message: '目标字段无效' })
  const permission = reading ? 'view' : action === 'create' || action === 'item-link' || action === 'cycle-map' || action === 'cycle-revoke' ? 'edit' : action
  const facts = await requireProductPermission(event, code, 'product_objectives', permission)
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/objectives:${action}`, {
    appCode: 'aims', method: 'POST', scope: reading ? 'aims.read aims:product-objectives:read' : `aims.write aims:product-objectives:${action}`,
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, authorization: { resource: 'product_objectives', action: permission, facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
