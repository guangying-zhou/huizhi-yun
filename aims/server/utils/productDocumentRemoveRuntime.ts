import { readProductDocumentMetadata } from './productDocumentCodocs'
import type { ProductDocumentRelation } from './productDocumentVisibility'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export function handleProductDocumentRemove(event: H3Event) {
  return handleProductDocumentMutation(event, 'remove')
}

export function handleProductDocumentPurpose(event: H3Event) {
  return handleProductDocumentMutation(event, 'edit')
}

export function handleProductDocumentRestore(event: H3Event) {
  return handleProductDocumentMutation(event, 'restore')
}

async function handleProductDocumentMutation(event: H3Event, action: 'remove' | 'edit' | 'restore') {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: '文档维护须使用 POST' })
  const code = getRouterParam(event, 'productCode') || ''
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!crossDependencyProductCode(code) || !key || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '产品、幂等键或查询参数无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (facts.product_code !== code || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const body = await readBody<Record<string, unknown>>(event)
  const fields = action === 'edit' ? ['bizId', 'expectedRevision', 'expectedDocumentRevision', 'purpose'] : ['bizId', 'expectedRevision', 'expectedDocumentRevision']
  const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length || Object.keys(body).some(name => !fields.includes(name)) || typeof body.bizId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.bizId) || body.bizId === '00000000-0000-0000-0000-000000000000' || !positive(body.expectedRevision) || !positive(body.expectedDocumentRevision)) throw createError({ statusCode: 400, message: '文档关系或修订无效' })
  if (action === 'edit' && (typeof body.purpose !== 'string' || !['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'].includes(body.purpose))) throw createError({ statusCode: 400, message: '文档用途无效' })
  if (action === 'restore') {
    const readFacts = await requireProductPermission(event, code, 'product_documents', 'view')
    if (readFacts.product_code !== code || readFacts.actor_uid !== facts.actor_uid || readFacts.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新' })
    const relation = await maybeCallTenantRuntime<{ code: number, data: { product_code: string, workspace_revision: number, item: ProductDocumentRelation } }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:view`, {
      appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-documents:read', query: { current_user: facts.actor_uid },
      body: { input: { biz_id: body.bizId }, authorization: { resource: 'product_documents', action: 'view', facts: readFacts, expires_at: Date.now() + 15000 } }
    })
    if (!relation.handled) throw createError({ statusCode: 503, message: '产品文档关系服务暂不可用' })
    if (relation.data.code !== 0) throw runtimeEnvelopeError(relation.data)
    const detail = relation.data.data
    if (!detail || detail.product_code !== code || detail.workspace_revision !== readFacts.revision || detail.item?.product_code !== code || detail.item.biz_id !== body.bizId || typeof detail.item.document_uuid !== 'string') throw createError({ statusCode: 503, message: '产品文档关系响应不一致' })
    // Already-restored relations still reach Runtime so a successful receipt
    // can replay. Current Codocs access is required on every attempt.
    await readProductDocumentMetadata(event, code, detail.item.document_uuid)
  }
  // Runtime rechecks current permission before replay; do not reject an old
  // expected revision here, because a successful receipt may need replaying.
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:${action}`, {
    appCode: 'aims', method: 'POST', scope: `aims.write aims:product-documents:${action}`, query: { current_user: facts.actor_uid }, idempotencyKey: key,
    body: { input: { biz_id: body.bizId, expected_revision: body.expectedRevision, expected_document_revision: body.expectedDocumentRevision, ...(action === 'edit' ? { purpose: body.purpose } : {}) }, authorization: { resource: 'product_documents', action: 'edit', facts, expires_at: Date.now() + 15000 } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品文档运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}

export async function handleProductDocumentCreate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: '关联文档须使用 POST' })
  const code = getRouterParam(event, 'productCode') || ''
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!crossDependencyProductCode(code) || !key || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '产品、幂等键或查询参数无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'edit')
  if (facts.product_code !== code || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(name => !['documentUuid', 'purpose', 'expectedRevision'].includes(name)) || typeof body.documentUuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.documentUuid) || body.documentUuid === '00000000-0000-0000-0000-000000000000' || typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 || typeof body.purpose !== 'string' || !['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'].includes(body.purpose)) throw createError({ statusCode: 400, message: '文档标识、用途或修订无效' })
  await readProductDocumentMetadata(event, code, body.documentUuid)
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:create`, {
    appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-documents:create', query: { current_user: facts.actor_uid }, idempotencyKey: key,
    body: { input: { document_uuid: body.documentUuid, purpose: body.purpose, expected_revision: body.expectedRevision }, authorization: { resource: 'product_documents', action: 'edit', facts, expires_at: Date.now() + 15000 } }
  })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品文档运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  return result.data
}
