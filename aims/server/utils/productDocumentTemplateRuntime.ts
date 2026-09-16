import { dispatchProductDocumentRequest } from './productDocumentDispatch'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { readProductDocumentMetadata } from './productDocumentCodocs'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductDocumentTemplateCreate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: '模板创建须使用 POST' })
  const code = getRouterParam(event, 'productCode') || ''
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!crossDependencyProductCode(code) || !key || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '产品、幂等键或查询参数无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (facts.product_code !== code || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 4 || Object.keys(body).some(name => !['templateUuid', 'title', 'purpose', 'expectedRevision'].includes(name)) || !uuid(body.templateUuid) || typeof body.title !== 'string' || !body.title || body.title.trim() !== body.title || [...body.title].length > 200 || /\p{Cc}/u.test(body.title) || typeof body.purpose !== 'string' || !['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'].includes(body.purpose) || typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw createError({ statusCode: 400, message: '模板、标题、用途或修订无效' })
  await readProductDocumentMetadata(event, code, body.templateUuid)
  const current = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (current.product_code !== code || current.actor_uid !== facts.actor_uid || current.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新重试' })
  const result = await maybeCallTenantRuntime<{ code: number, data: { value: Record<string, unknown> } }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:template-create`, {
    appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-documents:create', query: { current_user: facts.actor_uid }, idempotencyKey: key,
    body: { input: { template_uuid: body.templateUuid, title: body.title, purpose: body.purpose, expected_revision: body.expectedRevision }, authorization: { resource: 'product_documents', action: 'edit', facts: current, expires_at: Date.now() + 15000 } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品文档创建服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  const value = result.data.data?.value
  if (!value || value.product_code !== code || !uuid(value.biz_id) || !uuid(value.operation_id) || !uuid(value.document_uuid) || typeof value.workspace_revision !== 'number' || !Number.isSafeInteger(value.workspace_revision) || value.workspace_revision < 1) throw createError({ statusCode: 503, message: '产品文档创建响应不一致' })
  // Persisted requests survive transport failures; recovery uses the same key.
  let creationConfirmed = false
  try {
    creationConfirmed = (await dispatchProductDocumentRequest(event, value.biz_id, code)).synced
  } catch {
    // The durable request remains available to the bounded background drain.
  }
  return { code: 0, data: { requestBizId: value.biz_id, workspaceRevision: value.workspace_revision, creationConfirmed } }
}
