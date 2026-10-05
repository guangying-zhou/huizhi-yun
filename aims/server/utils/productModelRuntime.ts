import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission, checkProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productModelCreateInput, productModelSelectInput, productModelPageInput, productRICEModelCreateInput } from './productModelInput'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductModel(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const path = getRouterParam(event, 'modelPath') || ''
  if (!crossDependencyProductCode(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  if (path === 'permissions') {
    if (event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
    if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '模型权限请求无效' })
    const source = await requireProductPermission(event, code, 'product_priorities', 'view')
    const admin = await checkProductPermission(event, code, 'product_priorities', 'admin')
    const other = admin.facts
    if (source.product_code !== code || other.product_code !== code || other.actor_uid !== source.actor_uid || other.revision !== source.revision || other.status !== source.status || other.is_member !== source.is_member || other.is_manager !== source.is_manager) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    return { code: 0, data: { product_code: code, status: source.status, revision: source.revision, admin: admin.allowed } }
  }
  const cycle = /^cycles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path)
  if (!['list', 'create', 'rice-create'].includes(path) && !cycle) throw createError({ statusCode: 404, message: '模型接口不存在' })
  const reading = path === 'list'
  if (event.method !== (reading ? 'GET' : 'POST')) throw createError({ statusCode: 405, message: '请求方法不支持' })
  let input: unknown
  let key: string | undefined
  if (reading) {
    const parsed = productModelPageInput(getQuery(event))
    if (!parsed) throw createError({ statusCode: 400, message: '模型分页参数无效' })
    input = parsed
  } else {
    if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '模型写入不接受查询参数' })
    key = productCommandKey(getHeader(event, 'Idempotency-Key')) || undefined
    if (!key) throw createError({ statusCode: 400, message: '请提供幂等键' })
    const raw = await readBody(event)
    input = cycle ? productModelSelectInput(raw, cycle[1]!) : path === 'rice-create' ? productRICEModelCreateInput(raw) : productModelCreateInput(raw)
    if (!input) throw createError({ statusCode: 400, message: '模型字段或修订无效' })
  }
  const action = reading ? 'list' : cycle ? 'cycle-select' : path
  const facts = await requireProductPermission(event, code, 'product_priorities', reading ? 'view' : 'admin')
  if (facts.product_code !== code) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/priority-models:${action}`, {
    appCode: 'aims', method: 'POST', scope: reading ? 'aims.read aims:product-priorities:read' : `aims.write aims:product-priorities:${cycle ? 'cycle-model-select' : 'model-create'}`,
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, authorization: { resource: 'product_priorities', action: reading ? 'view' : 'admin', facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '模型运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
