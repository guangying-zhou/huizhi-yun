import { createError } from 'h3'
import type { ProductDocumentMetadata } from './productDocumentCodocs'

export interface ProductDocumentRelation {
  biz_id: string
  product_code: string
  document_uuid: string
  purpose: string
  revision: number
  removed: boolean
}
export interface ProductDocumentCandidates {
  product_code: string
  workspace_revision: number
  items: ProductDocumentRelation[]
  total: number
  page: number
  pageSize: number
}
const purposes = new Set(['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'])
const positive = (value: number) => Number.isSafeInteger(value) && value > 0
const uuid = (value: string) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'

// Null means a confirmed document ACL denial only. Authentication and service
// failures must reject; they must never become a misleading restricted count.
export async function pageVisibleProductDocuments(options: {
  productCode: string
  page: number
  pageSize: number
  removed: boolean
  purpose?: string
  loadCandidates: (page: number, pageSize: number) => Promise<ProductDocumentCandidates>
  readMetadata: (documentUuid: string) => Promise<ProductDocumentMetadata | null>
  verifyRevision: (revision: number) => Promise<void>
}) {
  if (!positive(options.page) || options.page > 1000000 || !positive(options.pageSize) || options.pageSize > 100 || (options.purpose && !purposes.has(options.purpose))) throw createError({ statusCode: 400, message: '文档分页或用途无效' })
  const invalid = () => createError({ statusCode: 503, message: '产品文档关系响应无效' })
  const changed = () => createError({ statusCode: 409, message: '产品文档关系已变化，请刷新' })
  const items: Array<ProductDocumentRelation & { metadata: ProductDocumentMetadata }> = []
  const seen = new Set<string>(), documents = new Set<string>()
  let revision = 0, candidateTotal = 0, total = 0, restrictedCount = 0
  const start = (options.page - 1) * options.pageSize
  for (let page = 1; ; page++) {
    const result = await options.loadCandidates(page, 100)
    if (!result || result.product_code !== options.productCode || !positive(result.workspace_revision) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page || result.pageSize !== 100 || !Array.isArray(result.items)) throw invalid()
    if (page === 1) {
      revision = result.workspace_revision
      candidateTotal = result.total
    }
    if (result.workspace_revision !== revision || result.total !== candidateTotal) throw changed()
    if (result.items.length !== Math.min(100, Math.max(0, candidateTotal - (page - 1) * 100))) throw invalid()
    for (const row of result.items) {
      if (!row || row.product_code !== options.productCode || !uuid(row.biz_id) || !uuid(row.document_uuid) || !positive(row.revision) || row.removed !== options.removed || !purposes.has(row.purpose) || (options.purpose && row.purpose !== options.purpose) || seen.has(row.biz_id) || documents.has(row.document_uuid)) throw invalid()
      seen.add(row.biz_id)
      documents.add(row.document_uuid)
      const metadata = await options.readMetadata(row.document_uuid)
      if (metadata === null) {
        restrictedCount++
        continue
      }
      if (metadata.uuid !== row.document_uuid || ![metadata.title, metadata.doc_type, metadata.updated_at].every(value => typeof value === 'string' && value.trim())) throw invalid()
      if (total >= start && items.length < options.pageSize) items.push({
        biz_id: row.biz_id, product_code: row.product_code, document_uuid: row.document_uuid, purpose: row.purpose, revision: row.revision, removed: row.removed,
        metadata: { uuid: metadata.uuid, title: metadata.title, doc_type: metadata.doc_type, updated_at: metadata.updated_at }
      })
      total++
    }
    if (page * 100 >= candidateTotal) break
  }
  await options.verifyRevision(revision)
  return { product_code: options.productCode, workspace_revision: revision, items, total, restrictedCount, page: options.page, pageSize: options.pageSize }
}
