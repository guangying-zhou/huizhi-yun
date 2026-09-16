import { dispatchProductDocumentRequest } from './productDocumentDispatch'
import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { readProductDocumentMetadata } from './productDocumentCodocs'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export function handleProductDocumentRequestStatus(event: H3Event) {
  return handleRequest(event, false)
}
export function handleProductDocumentRequestResume(event: H3Event) {
  return handleRequest(event, true)
}
async function handleRequest(event: H3Event, resume: boolean) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== (resume ? 'POST' : 'GET')) throw createError({ statusCode: 405, message: '创建请求方法无效' })
  const code = getRouterParam(event, 'productCode') || ''
  if (!crossDependencyProductCode(code)) throw createError({ statusCode: 400, message: '产品标识无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (facts.product_code !== code || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  if (resume && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '恢复请求不接受查询参数' })
  const body = resume ? await readBody<Record<string, unknown>>(event) : getQuery(event)
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !uuid(body.requestBizId)) throw createError({ statusCode: 400, message: '创建请求无效' })
  const request = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:request-view`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-documents:read', query: { current_user: facts.actor_uid },
    body: { input: { biz_id: body.requestBizId }, authorization: { resource: 'product_documents', action: 'edit', facts, expires_at: Date.now() + 15000 } }
  })
  if (!request.handled) throw createError({ statusCode: 503, message: '创建请求服务暂不可用' })
  if (request.data.code !== 0) throw runtimeEnvelopeError(request.data)
  const detail = request.data.data
  if (!detail || detail.product_code !== code || detail.biz_id !== body.requestBizId || detail.workspace_revision !== facts.revision || !uuid(detail.document_uuid)) throw createError({ statusCode: 503, message: '创建请求响应不一致' })
  const statuses = ['pending', 'processing', 'retry_wait', 'partial_unknown', 'cancelled', 'failed_permanent', 'dead_letter', 'succeeded']
  if (typeof detail.status !== 'string' || !statuses.includes(detail.status) || typeof detail.relation_biz_id !== 'string' || (detail.relation_biz_id !== '' && !uuid(detail.relation_biz_id))) throw createError({ statusCode: 503, message: '创建请求状态无效' })
  if (detail.status === 'succeeded') await readProductDocumentMetadata(event, code, detail.document_uuid)
  const current = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (current.product_code !== code || current.actor_uid !== facts.actor_uid || current.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新重试' })
  if (resume && ['pending', 'retry_wait', 'partial_unknown'].includes(detail.status)) {
    await dispatchProductDocumentRequest(event, body.requestBizId, code)
  }
  // This is the observed state before delivery; callers query again after resume.
  return { code: 0, data: { requestBizId: body.requestBizId, status: detail.status, workspaceRevision: facts.revision, relationBizId: detail.status === 'succeeded' ? detail.relation_biz_id : '' } }
}
