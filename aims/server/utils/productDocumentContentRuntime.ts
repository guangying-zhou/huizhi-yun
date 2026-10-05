import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { readProductDocumentContent } from './productDocumentCodocs'
import type { ProductDocumentRelation } from './productDocumentVisibility'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductDocumentContent(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '文档阅读须使用 GET' })
  const code = getRouterParam(event, 'productCode') || ''
  const query = getQuery(event)
  const bizId = query.bizId
  if (!crossDependencyProductCode(code) || Object.keys(query).length !== 1 || typeof bizId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId) || bizId === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 400, message: '产品文档关联标识无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'view')
  if (facts.product_code !== code || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const relation = await maybeCallTenantRuntime<{ code: number, data: { product_code: string, workspace_revision: number, item: ProductDocumentRelation } }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:view`, {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-documents:read', query: { current_user: facts.actor_uid },
    body: { input: { biz_id: bizId }, authorization: { resource: 'product_documents', action: 'view', facts, expires_at: Date.now() + 15000 } }
  })
  if (!relation.handled) throw createError({ statusCode: 503, message: '产品文档关系服务暂不可用' })
  if (relation.data.code !== 0) throw runtimeEnvelopeError(relation.data)
  const detail = relation.data.data
  if (!detail || detail.product_code !== code || detail.workspace_revision !== facts.revision || detail.item?.product_code !== code || detail.item.biz_id !== bizId || typeof detail.item.document_uuid !== 'string' || typeof detail.item.removed !== 'boolean') throw createError({ statusCode: 503, message: '产品文档关系响应不一致' })
  if (detail.item.removed) throw createError({ statusCode: 404, message: '产品文档关联已解除' })
  const content = await readProductDocumentContent(event, code, detail.item.document_uuid)
  const current = await requireProductPermission(event, code, 'product_documents', 'view')
  if (current.product_code !== code || current.actor_uid !== facts.actor_uid || current.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档关联已变化，请刷新重试' })
  return { code: 0, data: content }
}
