import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { extractServiceOperationCode, extractServiceOperationStatus } from '@hzy/foundation/server/utils/serviceOperation'
import { requireProductPermission, checkProductPermission } from './productAuthorization'
import { productModelPageInput } from './productModelInput'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'
import { readProductDocumentMetadata } from './productDocumentCodocs'
import { pageVisibleProductDocuments, type ProductDocumentCandidates } from './productDocumentVisibility'

export async function handleProductDocumentList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '只支持读取产品文档列表' })
  const code = getRouterParam(event, 'productCode') || ''
  const { purpose, removed = 'false', ...query } = getQuery(event)
  const page = productModelPageInput(query)
  if (!crossDependencyProductCode(code) || !page || (purpose !== undefined && (typeof purpose !== 'string' || !['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'].includes(purpose))) || !['true', 'false'].includes(String(removed)) || typeof removed !== 'string') throw createError({ statusCode: 400, message: '产品文档筛选无效' })
  const facts = await requireProductPermission(event, code, 'product_documents', 'view')
  let canEdit = false
  const result = await pageVisibleProductDocuments({
    productCode: code, page: page.page, pageSize: page.page_size, purpose: purpose as string | undefined, removed: removed === 'true',
    loadCandidates: async (candidatePage, size) => {
      const response = await maybeCallTenantRuntime<{ code: number, data: ProductDocumentCandidates }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/documents:list`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-documents:read', query: { current_user: facts.actor_uid },
        body: { input: { page: candidatePage, page_size: size, purpose: purpose || '', removed: removed === 'true' }, authorization: { resource: 'product_documents', action: 'view', facts, expires_at: Date.now() + 15000 } }
      })
      if (!response.handled) throw createError({ statusCode: 503, message: '产品文档运行服务暂不可用' })
      if (response.data.code !== 0) throw runtimeEnvelopeError(response.data)
      if (response.data.data.workspace_revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档关系已变化，请刷新' })
      return response.data.data
    },
    readMetadata: async (uuid) => {
      try {
        return await readProductDocumentMetadata(event, code, uuid)
      } catch (error) {
        const status = extractServiceOperationStatus(error)
        const errorCode = extractServiceOperationCode(error, status)
        if (status === 403 && ['permission_denied', 'product_document_inactive'].includes(errorCode)) return null
        throw error
      }
    },
    verifyRevision: async (revision) => {
      const current = await requireProductPermission(event, code, 'product_documents', 'view')
      if (current.revision !== revision || current.actor_uid !== facts.actor_uid) throw createError({ statusCode: 409, message: '产品文档关系已变化，请刷新' })
      const edit = await checkProductPermission(event, code, 'product_documents', 'edit')
      if (edit.facts.product_code !== code || edit.facts.revision !== revision || edit.facts.actor_uid !== facts.actor_uid || edit.facts.status !== current.status) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新' })
      canEdit = edit.allowed && current.status === 'active'
    }
  })
  return { code: 0, data: { ...result, canEdit } }
}
