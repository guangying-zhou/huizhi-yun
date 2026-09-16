import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission, checkProductPermission } from './productAuthorization'
import { productRoadmapRoute, productRoadmapWindowInput, productQuarterRoadmapInput, productRoadmapCommitInput, productRoadmapHistoryInput } from './productRoadmapInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { productRoadmapPermissions } from './productRoadmapPermissions'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductRoadmap(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || !code.isWellFormed() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '路线图请求无效' })
  const path = getRouterParam(event, 'roadmapPath') || ''
  const historyMatch = /^commitments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path)
  const crossMatch = /^cross-snapshots\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path)
  if (path === 'quarter' || historyMatch || crossMatch) {
    if (event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
    const input = historyMatch || crossMatch ? productRoadmapHistoryInput(getQuery(event), (historyMatch || crossMatch)![1]!) : productQuarterRoadmapInput(getQuery(event))
    if (!input) throw createError({ statusCode: 400, message: '路线读取参数无效' })
    const facts = await requireProductPermission(event, code, 'product_roadmaps', 'view')
    const planning = await requireProductPermission(event, code, 'product_priorities', 'view')
    if (facts.product_code !== planning.product_code || facts.actor_uid !== planning.actor_uid || facts.status !== planning.status || facts.revision !== planning.revision || facts.is_member !== planning.is_member || facts.is_manager !== planning.is_manager) throw createError({ statusCode: 409, message: '产品权限状态已变化，请重新加载' })
    if (facts.product_code !== code) throw createError({ statusCode: 409, message: '产品权限状态已变化，请重新加载' })
    if (crossMatch) {
      const discovered = await maybeCallTenantRuntime<{ code: number, data: { product_code: string, commitment_biz_id: string, workspace_revision: number, product_codes: string[] } }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/roadmaps:cross-snapshot-targets`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-roadmaps:read', query: { current_user: facts.actor_uid },
        body: { input: { biz_id: crossMatch[1] }, authorization: { resource: 'product_roadmaps', action: 'view', facts, expires_at: Date.now() + 15000 }, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planning, expires_at: Date.now() + 15000 } }
      })
      if (!discovered.handled) throw createError({ statusCode: 503, message: '历史前置发现服务暂不可用' })
      if (discovered.data.code !== 0) throw runtimeEnvelopeError(discovered.data)
      const found = discovered.data.data
      if (!found || found.product_code !== code || found.commitment_biz_id !== crossMatch[1] || found.workspace_revision !== facts.revision || !Array.isArray(found.product_codes) || found.product_codes.length > 100 || found.product_codes.some(target => !crossDependencyProductCode(target) || target === code) || new Set(found.product_codes).size !== found.product_codes.length) throw createError({ statusCode: 409, message: '历史前置范围已变化，请重新加载' })
      const allowed: Record<string, typeof facts> = Object.create(null)
      for (const target of found.product_codes) {
        const decision = await checkProductPermission(event, target, 'product_priorities', 'view')
        if (!decision.allowed) continue
        if (decision.facts.actor_uid !== facts.actor_uid || decision.facts.product_code !== target) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
        allowed[target] = decision.facts
      }
      const expires = Date.now() + 15000
      const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/roadmaps:cross-snapshots`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-roadmaps:read', query: { current_user: facts.actor_uid },
        body: { input, authorization: { resource: 'product_roadmaps', action: 'view', facts, expires_at: expires }, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planning, expires_at: expires }, predecessor_authorizations: Object.fromEntries(Object.entries(allowed).map(([target, targetFacts]) => [target, { resource: 'product_priorities', action: 'view', facts: targetFacts, expires_at: expires }])) }
      })
      if (!runtime.handled) throw createError({ statusCode: 503, message: '历史前置读取服务暂不可用' })
      if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
      return runtime.data
    }
    const expires = Date.now() + 15000
    const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/roadmaps:${historyMatch ? 'commitments' : 'quarter-view'}`, {
      appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-roadmaps:read', query: { current_user: facts.actor_uid },
      body: { input, authorization: { resource: 'product_roadmaps', action: 'view', facts, expires_at: expires }, planning_authorization: { resource: 'product_priorities', action: 'view', facts: planning, expires_at: expires } }
    })
    if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
    if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
    return runtime.data
  }
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '路线图请求无效' })
  if (getRouterParam(event, 'roadmapPath') === 'permissions') {
    if (event.method !== 'GET') throw createError({ statusCode: 405, message: '请求方法不支持' })
    return productRoadmapPermissions(event, code)
  }
  const route = productRoadmapRoute(getRouterParam(event, 'roadmapPath'), event.method)
  if (!route) throw createError({ statusCode: 404, message: '路线图接口不存在' })
  if (!route.methodAllowed) throw createError({ statusCode: 405, message: '请求方法不支持' })
  const reading = route.action === 'window-view'
  const key = reading ? undefined : productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!reading && !key) throw createError({ statusCode: 400, message: '请提供幂等键' })
  const input = reading ? { biz_id: route.id } : route.action === 'commit' ? productRoadmapCommitInput(await readBody(event), route.id) : productRoadmapWindowInput(await readBody(event), route.id)
  if (!input) throw createError({ statusCode: 400, message: '探索时间窗口字段无效' })
  const permission = reading ? 'view' : route.action === 'commit' ? 'commit' : 'edit'
  const facts = await requireProductPermission(event, code, 'product_roadmaps', permission)
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/roadmaps:${route.action}`, {
    appCode: 'aims', method: 'POST', scope: reading ? 'aims.read aims:product-roadmaps:read' : `aims.write aims:product-roadmaps:${route.action}`,
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, authorization: { resource: 'product_roadmaps', action: permission, facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
