import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission, checkProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productSavedViewReadInput, productSavedViewWriteInput } from './productSavedViewInput'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductSavedView(event: H3Event, viewPath?: string): Promise<{ code: number, data: unknown }> {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || '', path = viewPath ?? getRouterParam(event, 'viewPath') ?? ''
  if (!crossDependencyProductCode(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  const match = /^(list|create|permissions|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/apply)?$/.exec(path)
  if (!match || (match[2] && ['list', 'create', 'permissions'].includes(match[1]!))) throw createError({ statusCode: 404, message: '保存视图接口不存在' })
  const id = ['list', 'create', 'permissions'].includes(match[1]!) ? undefined : match[1]
  const action = path === 'permissions' ? 'permissions' : path === 'list' ? 'list' : path === 'create' ? 'create' : match[2] ? 'apply' : event.method === 'PATCH' ? 'update' : event.method === 'DELETE' ? 'delete' : 'view'
  const writing = ['create', 'update', 'delete'].includes(action)
  const expectedMethod = action === 'create' ? 'POST' : action === 'update' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'GET'
  if (event.method !== expectedMethod) throw createError({ statusCode: 405, message: '请求方法不支持' })
  const query = getQuery(event)
  let input: unknown, key: string | undefined
  if (writing) {
    if (Object.keys(query).length) throw createError({ statusCode: 400, message: '视图写入不接受查询参数' })
    key = productCommandKey(getHeader(event, 'Idempotency-Key')) || undefined
    input = productSavedViewWriteInput(action as 'create' | 'update' | 'delete', await readBody(event), id)
    if (!key || !input) throw createError({ statusCode: 400, message: '视图字段、修订或幂等键无效' })
  } else if (action !== 'permissions') {
    input = productSavedViewReadInput(action as 'list' | 'view' | 'apply', query, id)
    if (!input) throw createError({ statusCode: 400, message: '视图查询参数无效' })
  } else if (Object.keys(query).length) throw createError({ statusCode: 400, message: '权限查询不接受参数' })
  const planning = await requireProductPermission(event, code, 'product_priorities', 'view')
  const roadmap = await requireProductPermission(event, code, 'product_roadmaps', 'view')
  const consistent = (other: typeof planning) => [planning, other].every(facts => facts.product_code === code) && ['actor_uid', 'revision', 'status', 'is_member', 'is_manager'].every(key => planning[key as keyof typeof planning] === other[key as keyof typeof planning])
  if (!consistent(roadmap)) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
  let roadmapAction = 'view', roadmapFacts = roadmap
  if (writing || action === 'permissions') {
    const edit = await checkProductPermission(event, code, 'product_roadmaps', 'edit')
    if (!consistent(edit.facts)) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    if (action === 'permissions') return { code: 0, data: { product_code: code, actor_uid: planning.actor_uid, revision: planning.revision, status: planning.status, edit: edit.allowed } }
    const sharedCreate = action === 'create' && (input as { definition: { visibility: string } }).definition.visibility === 'product'
    if (sharedCreate && !edit.allowed) throw createError({ statusCode: 403, message: '没有创建共享视图的权限' })
    if ((action !== 'create' || sharedCreate) && edit.allowed) {
      roadmapAction = 'edit'
      roadmapFacts = edit.facts
    }
  }
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/roadmap-views:${action}`, {
    appCode: 'aims', method: 'POST', scope: writing ? `aims.write aims:product-roadmaps:view-${action}` : 'aims.read aims:product-roadmaps:read', query: { current_user: planning.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planning, expires_at: Date.now() + 15000 }, authorization: { resource: 'product_roadmaps', action: roadmapAction, facts: roadmapFacts, expires_at: Date.now() + 15000 } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}
