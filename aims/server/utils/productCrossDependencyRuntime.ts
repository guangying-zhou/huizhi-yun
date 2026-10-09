import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission, checkProductPermission } from './productAuthorization'
import { crossDependencyProductCode, crossDependencyWriteInput } from './productCrossDependencyInput'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductCrossDependency(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const path = getRouterParam(event, 'crossPath') || ''
  if (path === 'permissions') {
    if (!crossDependencyProductCode(code) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '依赖权限请求无效' })
    if (event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
    const source = await requireProductPermission(event, code, 'product_priorities', 'view')
    const edit = await checkProductPermission(event, code, 'product_priorities', 'edit')
    const other = edit.facts
    if (source.product_code !== code || other.product_code !== code || other.actor_uid !== source.actor_uid || other.revision !== source.revision || other.status !== source.status || other.is_member !== source.is_member || other.is_manager !== source.is_manager) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    return { code: 0, data: { product_code: code, status: source.status, revision: source.revision, edit: edit.allowed } }
  }
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const list = new RegExp(`^items/(${uuid})$`).exec(path)
  if (list && event.method === 'GET') {
    const query = getQuery(event)
    let targets = typeof query.predecessorProductCode === 'string' ? [query.predecessorProductCode] : query.predecessorProductCode
    const integer = (value: unknown, max: number) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : null
    const page = integer(query.page ?? '1', 1000000), pageSize = integer(query.pageSize ?? '20', 100)
    if (!crossDependencyProductCode(code) || Object.keys(query).some(key => !['predecessorProductCode', 'page', 'pageSize'].includes(key)) || (targets !== undefined && (!Array.isArray(targets) || !targets.length || targets.length > 100 || targets.some(target => !crossDependencyProductCode(target) || target === code) || new Set(targets).size !== targets.length)) || page === null || pageSize === null) throw createError({ statusCode: 400, message: '依赖列表筛选无效' })
    const source = await requireProductPermission(event, code, 'product_priorities', 'view')
    const automatic = targets === undefined
    if (automatic) {
      const discovered = await maybeCallTenantRuntime<{ code: number, data: { product_code: string, item_biz_id: string, workspace_revision: number, product_codes: string[] } }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/cross-dependencies:targets`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-priorities:read', query: { current_user: source.actor_uid },
        body: { input: { item_biz_id: list[1] }, authorization: { resource: 'product_priorities', action: 'view', facts: source, expires_at: Date.now() + 15000 } }
      })
      if (!discovered.handled) throw createError({ statusCode: 503, message: '依赖发现服务暂不可用' })
      if (discovered.data.code !== 0) throw runtimeEnvelopeError(discovered.data)
      const found = discovered.data.data
      if (!found || found.product_code !== code || found.item_biz_id !== list[1] || found.workspace_revision !== source.revision || !Array.isArray(found.product_codes) || found.product_codes.length > 100 || found.product_codes.some(target => !crossDependencyProductCode(target) || target === code) || new Set(found.product_codes).size !== found.product_codes.length) throw createError({ statusCode: 409, message: '依赖范围已变化，请重新加载' })
      targets = found.product_codes
    }
    if (source.product_code !== code) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    const targetFacts: Record<string, typeof source> = Object.create(null)
    for (const targetCode of targets as string[]) {
      const decision = automatic ? await checkProductPermission(event, targetCode, 'product_priorities', 'view') : { allowed: true, facts: await requireProductPermission(event, targetCode, 'product_priorities', 'view') }
      if (!decision.allowed) continue
      const facts = decision.facts
      if (facts.actor_uid !== source.actor_uid || source.product_code !== code || facts.product_code !== targetCode) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
      targetFacts[targetCode] = facts
    }
    const expires = Date.now() + 15000
    const permits = Object.fromEntries(Object.entries(targetFacts).map(([targetCode, facts]) => [targetCode, { resource: 'product_priorities', action: 'view', facts, expires_at: expires }]))
    const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/cross-dependencies:list`, {
      appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-priorities:read', query: { current_user: source.actor_uid },
      body: { input: { item_biz_id: list[1], page, page_size: pageSize }, authorization: { resource: 'product_priorities', action: 'view', facts: source, expires_at: expires }, predecessor_authorizations: permits }
    })
    if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
    if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
    return runtime.data
  }
  const detail = new RegExp(`^edges/(${uuid})$`).exec(path)
  if (detail) {
    if (!crossDependencyProductCode(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
    if (event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
    const query = getQuery(event)
    if (Object.keys(query).some(key => key !== 'predecessorProductCode') || !crossDependencyProductCode(query.predecessorProductCode) || query.predecessorProductCode === code) throw createError({ statusCode: 400, message: '前置产品参数无效' })
    const source = await requireProductPermission(event, code, 'product_priorities', 'view')
    const target = await requireProductPermission(event, query.predecessorProductCode, 'product_priorities', 'view')
    if (source.actor_uid !== target.actor_uid || source.product_code !== code || target.product_code !== query.predecessorProductCode) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    const expires = Date.now() + 15000
    const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/cross-dependencies:view`, {
      appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-priorities:read', query: { current_user: source.actor_uid },
      body: { input: { biz_id: detail[1], predecessor_product_code: query.predecessorProductCode }, authorization: { resource: 'product_priorities', action: 'view', facts: source, expires_at: expires }, predecessor_authorization: { resource: 'product_priorities', action: 'view', facts: target, expires_at: expires } }
    })
    if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
    if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
    return runtime.data
  }
  const match = new RegExp(`^items/(${uuid})(?:/(${uuid})/remove)?$`).exec(path)
  if (!crossDependencyProductCode(code) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '跨产品依赖请求无效' })
  if (!match) throw createError({ statusCode: 404, message: '跨产品依赖接口不存在' })
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: '请求方法不支持' })
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!key) throw createError({ statusCode: 400, message: '请提供幂等键' })
  const input = crossDependencyWriteInput(await readBody(event), code, match[1]!, match[2])
  if (!input) throw createError({ statusCode: 400, message: '依赖字段或修订无效' })
  const source = await requireProductPermission(event, code, 'product_priorities', 'edit')
  const target = await requireProductPermission(event, input.predecessor_product_code, 'product_priorities', 'view')
  if (source.actor_uid !== target.actor_uid || source.product_code !== code || target.product_code !== input.predecessor_product_code) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
  const action = match[2] ? 'remove' : 'create'
  const expires = Date.now() + 15000
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/cross-dependencies:${action}`, {
    appCode: 'aims', method: 'POST', scope: `aims.write aims:product-priorities:cross-dependency-${action}`, query: { current_user: source.actor_uid }, idempotencyKey: key,
    body: { input, authorization: { resource: 'product_priorities', action: 'edit', facts: source, expires_at: expires }, predecessor_authorization: { resource: 'product_priorities', action: 'view', facts: target, expires_at: expires } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
