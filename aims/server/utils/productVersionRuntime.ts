import type { ProductCommandBridge } from './productCommandBridge'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productVersionCreateInput, productVersionPageInput, productVersionEditInput, productVersionID } from './productVersionInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { productVersionTransitionInput } from './productVersionTransitionInput'
import { productRequestPageInput } from './productRequestInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductVersionCollection(event: H3Event, action: 'list' | 'create' | 'view' | 'edit' | 'release-view' | 'release-list' | 'transition', bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const writing = action === 'create' || action === 'edit' || action === 'transition'
  const id = action === 'transition' || action === 'view' || action === 'edit' || (action === 'release-view' || action === 'release-list') ? productVersionID(getRouterParam(event, 'versionId')) : null
  if ((action === 'transition' || action === 'view' || action === 'edit' || action === 'release-view' || action === 'release-list') && id === null) throw createError({ statusCode: 400, message: '版本标识无效' })
  const recordID = action === 'release-view' ? productVersionID(getRouterParam(event, 'recordId')) : null
  if (action === 'release-view' && recordID === null) throw createError({ statusCode: 400, message: '发布记录标识无效' })
  const key = writing ? productCommandKey(getHeader(event, 'Idempotency-Key')) : undefined
  if ((writing && !key) || (action !== 'list' && action !== 'release-list' && Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400, message: '版本创建请求无效' })
  const query = getQuery(event)
  const releasePage = action === 'release-list' && !Object.keys(query).some(key => !['page', 'pageSize'].includes(key)) ? productRequestPageInput(query) : null
  if (action === 'release-list' && !releasePage) throw createError({ statusCode: 400, message: '发布记录分页参数无效' })
  const input = action === 'transition' ? productVersionTransitionInput(await readBody(event), id!) : action === 'release-list' ? { version_id: id, page: releasePage!.page, page_size: releasePage!.page_size } : action === 'release-view' ? { version_id: id, record_id: recordID } : action === 'list' ? productVersionPageInput(getQuery(event)) : action === 'view' ? { version_id: id } : action === 'edit' ? productVersionEditInput(await readBody(event), id!) : productVersionCreateInput(await readBody(event))
  if (!input) throw createError({ statusCode: 400, message: '版本字段或分页条件无效' })
  const permission = writing ? 'edit' : 'view'
  const facts = await requireProductPermission(event, code, 'product_versions', permission, bridge?.authorizationSource)
  const body = { input, authorization: { resource: 'product_versions', action: permission, facts, expires_at: Date.now() + 15000 } }
  const runtime = bridge
    ? { handled: true as const, data: await bridge.call(code, action, body, key || undefined) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:${action}`, {
        appCode: 'aims', method: 'POST', scope: writing ? `aims.write aims:product-versions:${action === 'transition' ? 'edit' : action}` : 'aims.read aims:product-versions:read',
        query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
        body
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
