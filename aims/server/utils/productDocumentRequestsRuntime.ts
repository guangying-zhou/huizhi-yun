import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductDocumentRequests(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '查询创建状态须使用 GET' })
  const code = getRouterParam(event, 'productCode') || ''
  if (!crossDependencyProductCode(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (facts.product_code !== code || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const query = getQuery(event)
  const parse = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0
  const page = parse(query.page, 1), pageSize = parse(query.pageSize, 10)
  if (Object.keys(query).some(key => !['page', 'pageSize'].includes(key)) || page < 1 || page > 100000 || pageSize < 1 || pageSize > 100) throw createError({ statusCode: 400, message: '请求分页参数无效' })
  const request = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:requests-list`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-documents:read', query: { current_user: facts.actor_uid },
    body: { input: { page, page_size: pageSize }, authorization: { resource: 'product_documents', action: 'edit', facts, expires_at: Date.now() + 15000 } }
  })
  if (!request.handled) throw createError({ statusCode: 503, message: '创建请求服务暂不可用' })
  if (request.data.code !== 0) throw runtimeEnvelopeError(request.data)
  const detail = request.data.data
  if (!detail || detail.product_code !== code || detail.workspace_revision !== facts.revision || detail.page !== page || detail.pageSize !== pageSize || typeof detail.total !== 'number' || !Number.isSafeInteger(detail.total) || detail.total < 0 || !Array.isArray(detail.items) || detail.items.length !== Math.min(pageSize, Math.max(0, detail.total - (page - 1) * pageSize))) throw createError({ statusCode: 503, message: '创建请求分页响应不一致' })
  const statuses = ['pending', 'processing', 'retry_wait', 'partial_unknown', 'cancelled', 'failed_permanent', 'dead_letter', 'succeeded']
  const purposes = ['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other']
  const seen = new Set<string>()
  const items = detail.items.map((item: Record<string, unknown>) => {
    if (!item || typeof item.biz_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.biz_id) || item.biz_id === '00000000-0000-0000-0000-000000000000' || seen.has(item.biz_id) || typeof item.purpose !== 'string' || !purposes.includes(item.purpose) || typeof item.status !== 'string' || !statuses.includes(item.status) || typeof item.linked !== 'boolean') throw createError({ statusCode: 503, message: '创建请求记录无效' })
    seen.add(item.biz_id)
    return { requestBizId: item.biz_id, purpose: item.purpose, status: item.status, linked: item.linked }
  })
  const current = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (current.product_code !== code || current.actor_uid !== facts.actor_uid || current.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新重试' })
  return { code: 0, data: { items, total: detail.total, page, pageSize, workspaceRevision: facts.revision } }
}
