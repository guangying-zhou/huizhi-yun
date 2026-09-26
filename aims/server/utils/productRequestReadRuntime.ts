import type { ProductCommandBridge } from './productCommandBridge'
import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productRequestPageInput } from './productRequestInput'
import { hasProductControlCharacter } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductRequestRead(event: H3Event, action: 'list' | 'view' | 'sources', bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const id = getRouterParam(event, 'requestId') || ''
  const query = getQuery(event)
  const sourcePage = action === 'sources' && Object.keys(query).every(key => ['page', 'pageSize'].includes(key)) ? productRequestPageInput(query) : null
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  const input = action === 'sources'
    ? validId && sourcePage ? { biz_id: id, page: sourcePage.page, page_size: sourcePage.page_size } : null
    : action === 'list'
      ? productRequestPageInput(query)
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) && Object.keys(query).length === 0 ? { biz_id: id } : null
  if (!input) throw createError({ statusCode: 400, message: '需求查询条件无效' })
  const facts = await requireProductPermission(event, code, 'product_requests', 'view', bridge?.authorizationSource)
  const body = { input, authorization: { resource: 'product_requests', action: 'view', facts, expires_at: Date.now() + 15000 } }
  const runtime = bridge
    ? { handled: true as const, data: await bridge.call(code, action === 'sources' ? 'source-list' : action, body) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/${action === 'sources' ? 'request-sources:list' : `requests:${action}`}`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-requests:read',
        query: { current_user: facts.actor_uid },
        body
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
