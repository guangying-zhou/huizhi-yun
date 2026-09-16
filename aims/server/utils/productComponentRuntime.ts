import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productComponentDeleteInput, productComponentEditInput, productComponentPageInput, productComponentWriteInput } from './productComponentInput'
import { productVersionID } from './productVersionInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductComponent(event: H3Event, action: 'list' | 'create' | 'move' | 'edit' | 'delete') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || !code.isWellFormed() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  const reading = action === 'list'
  const id = (action === 'move' || action === 'edit' || action === 'delete') ? productVersionID(getRouterParam(event, 'componentId')) : undefined
  if (id === null) throw createError({ statusCode: 400, message: '模块标识无效' })
  const key = reading ? undefined : productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!reading && (!key || Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400, message: '模块请求无效' })
  const input = action === 'delete' ? productComponentDeleteInput(await readBody(event), id!) : action === 'edit' ? productComponentEditInput(await readBody(event), id!) : reading ? productComponentPageInput(getQuery(event)) : productComponentWriteInput(await readBody(event), id)
  if (!input) throw createError({ statusCode: 400, message: '模块字段无效' })
  const permission = reading ? 'view' : action === 'delete' ? 'delete' : 'edit'
  const facts = await requireProductPermission(event, code, 'product_components', permission)
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/components:${action}`, {
    appCode: 'aims', method: 'POST', scope: reading ? 'aims.read aims:product-components:read' : `aims.write aims:product-components:${action}`,
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, authorization: { resource: 'product_components', action: permission, facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
