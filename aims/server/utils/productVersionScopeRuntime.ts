import { productVersionVisibilityInput } from './productVersionVisibilityInput'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productRequestPageInput } from './productRequestInput'
import { productVersionLegacyCriteriaInput } from './productVersionLegacyCriteriaInput'
import { productVersionArchiveInput } from './productVersionArchiveInput'
import { productVersionID } from './productVersionInput'
import { productVersionScopeInput, productVersionScopePageInput, productVersionScopeDeliveryInput } from './productVersionScopeInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductVersionScope(event: H3Event, action: 'list' | 'history' | 'create' | 'edit' | 'deliver' | 'reopen' | 'legacy-criteria' | 'visibility') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const id = productVersionID(getRouterParam(event, 'versionId'))
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code) || id === null) throw createError({ statusCode: 400, message: '产品或版本标识无效' })
  const reading = action === 'list' || action === 'history'
  const scopeID = action === 'visibility' || action === 'legacy-criteria' || action === 'history' || action === 'edit' || action === 'deliver' || action === 'reopen' ? productVersionID(getRouterParam(event, 'scopeId')) : null
  if ((action === 'visibility' || action === 'legacy-criteria' || action === 'history' || action === 'edit' || action === 'deliver' || action === 'reopen') && scopeID === null) throw createError({ statusCode: 400, message: '版本范围标识无效' })
  const key = !reading ? productCommandKey(getHeader(event, 'Idempotency-Key')) : undefined
  if (!reading && (!key || Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400, message: '版本范围请求无效' })
  if (action === 'history' && Object.keys(getQuery(event)).some(key => !['page', 'pageSize'].includes(key))) throw createError({ statusCode: 400, message: '历史查询参数无效' })
  const historyPage = action === 'history' ? productRequestPageInput(getQuery(event)) : null
  const parsed = action === 'visibility' ? productVersionVisibilityInput(await readBody(event), id) : action === 'legacy-criteria' ? productVersionLegacyCriteriaInput(await readBody(event), id) : action === 'history' ? historyPage : action === 'reopen' ? productVersionArchiveInput(await readBody(event), id) : action === 'list' ? productVersionScopePageInput(getQuery(event)) : action === 'deliver' ? productVersionScopeDeliveryInput(await readBody(event), id, scopeID!) : productVersionScopeInput(await readBody(event), id, action === 'create')
  if (!parsed) throw createError({ statusCode: 400, message: '版本范围字段无效' })
  const permission = reading ? 'view' : (action === 'deliver' || action === 'reopen') ? 'accept' : 'edit'
  const facts = await requireProductPermission(event, code, 'product_versions', permission)
  const planning = action === 'create' || action === 'edit' ? await requireProductPermission(event, code, 'product_priorities', 'prioritize') : null
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:scope-${action}`, {
    appCode: 'aims', method: 'POST', scope: reading ? 'aims.read aims:product-versions:read' : `aims.write aims:product-versions:scope-${action}`,
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: {
      input: { ...(action === 'history' ? { page: historyPage!.page, page_size: historyPage!.page_size } : parsed), version_id: id, ...(scopeID ? { scope_id: scopeID } : {}) }, authorization: { resource: 'product_versions', action: permission, facts, expires_at: Date.now() + 15000 },
      ...(planning ? { planning_authorization: { resource: 'product_priorities', action: 'prioritize', facts: planning, expires_at: Date.now() + 15000 } } : {})
    }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
