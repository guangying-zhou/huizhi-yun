import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission, checkProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productReachCreateInput, productReachReadInput } from './productReachInput'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductReach(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const path = getRouterParam(event, 'reachPath') || ''
  if (!crossDependencyProductCode(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  if (path === 'permissions') {
    if (event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
    if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'Reach 权限请求无效' })
    const source = await requireProductPermission(event, code, 'product_priorities', 'view')
    const assess = await checkProductPermission(event, code, 'product_priorities', 'assess')
    const other = assess.facts
    if (source.product_code !== code || other.product_code !== code || other.actor_uid !== source.actor_uid || other.revision !== source.revision || other.status !== source.status || other.is_member !== source.is_member || other.is_manager !== source.is_manager) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    return { code: 0, data: { product_code: code, status: source.status, revision: source.revision, assess: assess.allowed } }
  }
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const match = new RegExp('^items/(' + uuid + ')(?:/(' + uuid + '))?$').exec(path)
  if (!match) throw createError({ statusCode: 404, message: 'Reach 接口不存在' })
  const writing = event.method === 'POST' && !match[2]
  if (!writing && event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
  const query = getQuery(event)
  let key: string | undefined
  let input: unknown
  if (writing) {
    if (Object.keys(query).length) throw createError({ statusCode: 400, message: 'Reach 写入不接受查询参数' })
    key = productCommandKey(getHeader(event, 'Idempotency-Key')) || undefined
    if (!key) throw createError({ statusCode: 400, message: '请提供幂等键' })
    input = productReachCreateInput(await readBody(event), match[1]!)
  } else input = productReachReadInput(query, match[1]!, match[2])
  if (!input) throw createError({ statusCode: 400, message: 'Reach 参数或修订无效' })
  const action = writing ? 'record' : match[2] ? 'view' : 'list'
  const permission = writing ? 'assess' : 'view'
  const facts = await requireProductPermission(event, code, 'product_priorities', permission)
  if (facts.product_code !== code) throw createError({ statusCode: 409, message: '产品授权上下文已变化' })
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, '/v1/aims/internal/products/' + encodeURIComponent(code) + '/reach-observations:' + action, {
    appCode: 'aims', method: 'POST', scope: writing ? 'aims.write aims:product-priorities:reach-record' : 'aims.read aims:product-priorities:read',
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, authorization: { resource: 'product_priorities', action: permission, facts, expires_at: Date.now() + 15000 } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: 'Reach 运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}
