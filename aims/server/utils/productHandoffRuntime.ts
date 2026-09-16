import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { checkAimsScopedPermission } from './aimsScopedAuthorization'
import { productHandoffProjectObject, type ProductHandoffProjectFacts } from './productHandoffProjectAuthorizationCore'
import { productHandoffInput } from './productHandoffInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductHandoff(event: H3Event, source: 'planning' | 'request') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!key || !code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '转交路径或幂等键无效' })
  const raw = await readBody<unknown>(event)
  let body = raw
  let itemId = getRouterParam(event, 'itemId') || ''
  if (source === 'request') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, message: '转交参数无效' })
    const { planningItemId, ...rest } = raw as Record<string, unknown>
    if (typeof planningItemId !== 'string') throw createError({ statusCode: 400, message: '请选择对应的规划事项' })
    itemId = planningItemId
    body = rest
  }
  const input = productHandoffInput(body, itemId, source === 'request' ? getRouterParam(event, 'requestId') || '' : undefined)
  if (!input) throw createError({ statusCode: 400, message: '转交参数无效' })
  const planningFacts = await requireProductPermission(event, code, 'product_priorities', 'handoff')
  const requestFacts = input.request_biz_id ? await requireProductPermission(event, code, 'product_requests', 'handoff') : null
  const versionFacts = input.planned_version_id ? await requireProductPermission(event, code, 'product_versions', 'view') : null
  const uid = planningFacts.actor_uid
  const project = await maybeCallTenantRuntime<{ code: number, data: ProductHandoffProjectFacts }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/handoff-project:authorization`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-priorities:project-authorization', query: { current_user: uid }, body: { input: { project_code: input.project_code } }
  })
  if (!project.handled) throw createError({ statusCode: 503, message: '项目授权数据暂不可用' })
  if (project.data.code !== 0) throw runtimeEnvelopeError(project.data)
  const object = productHandoffProjectObject(project.data.data, input.project_code, uid)
  if (!object) throw createError({ statusCode: 503, message: '项目授权上下文不一致' })
  if (!await checkAimsScopedPermission(event, { resourceCode: 'requirements', action: 'edit', object })) throw createError({ statusCode: 403, message: '没有目标项目的需求编辑权限' })
  const expires = Date.now() + 15000
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/planning-handoff:create`, {
    appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-priorities:handoff', query: { current_user: uid }, idempotencyKey: key,
    body: {
      input,
      planning_authorization: { resource: 'product_priorities', action: 'handoff', facts: planningFacts, expires_at: expires },
      project_authorization: { resource: 'requirements', action: 'edit', facts: project.data.data, expires_at: expires },
      ...(requestFacts ? { request_authorization: { resource: 'product_requests', action: 'handoff', facts: requestFacts, expires_at: expires } } : {}),
      ...(versionFacts ? { version_authorization: { resource: 'product_versions', action: 'view', facts: versionFacts, expires_at: expires } } : {})
    }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
