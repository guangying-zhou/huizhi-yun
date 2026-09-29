import { createError, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { checkProductPermission } from '../../../aims/server/utils/productAuthorization'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'
import { withEnterpriseCodocsDocumentContent } from './enterpriseCodocsDocumentContent'

type Action = 'list' | 'requests' | 'search' | 'content'
type RuntimeResponse = { code: number, data: Record<string, unknown> }
const operations = {
  list: 'aims.product-document-list', requests: 'aims.product-document-requests',
  search: 'aims.product-document-search', content: 'aims.product-document-content'
} as const
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
const purposes = new Set(['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'])

function parseQuery(event: H3Event, action: Action) {
  const raw = getQuery(event)
  const params = getRequestURL(event).searchParams
  const allowed = action === 'content' ? ['bizId'] : action === 'requests' ? ['page', 'pageSize'] : ['page', 'pageSize', 'purpose', 'removed', ...(action === 'search' ? ['search'] : [])]
  if (Object.keys(raw).some(key => !allowed.includes(key) || typeof raw[key] !== 'string' || params.getAll(key).length !== 1)) throw createError({ statusCode: 400, message: '产品文档查询参数无效' })
  if (action === 'content') {
    if (!uuid(raw.bizId)) throw createError({ statusCode: 400, message: '文档关联标识无效' })
    return { bizId: raw.bizId }
  }
  const parse = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0
  const page = parse(raw.page, 1), pageSize = parse(raw.pageSize, 20)
  if (page < 1 || page > 100000 || pageSize < 1 || pageSize > 100 || (raw.purpose !== undefined && !purposes.has(raw.purpose as string)) || (raw.removed !== undefined && !['true', 'false'].includes(raw.removed as string)) || (action === 'search' && (typeof raw.search !== 'string' || raw.search !== raw.search.trim() || [...raw.search].length > 200))) throw createError({ statusCode: 400, message: '产品文档查询参数无效' })
  return { page, pageSize, ...(action === 'requests' ? {} : { purpose: raw.purpose || '', removed: raw.removed === 'true', search: action === 'search' ? raw.search || '' : '' }) }
}

async function requireDocumentsAccess(event: H3Event, code: string) {
  const source = await enterpriseProductAuthorizationSource(event)
  const product = await checkProductPermission(event, code, 'products', 'view', source)
  if (!product.allowed) throw createError({ statusCode: 404, message: '产品不存在或不可见' })
  const documents = await checkProductPermission(event, code, 'product_documents', 'view', source)
  if (!documents.allowed) throw createError({ statusCode: 403, message: '缺少产品文档查看权限' })
  return documents.facts
}

export async function readEnterpriseProductDocuments(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || !code.isWellFormed() || [...code].length > 64 || code.includes('/') || /[\p{Cc}]/u.test(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const query = parseQuery(event, action)
  const user = await requireEnterpriseUser(event)
  const facts = await requireDocumentsAccess(event, code)
  await prepareEnterpriseRuntime(event, operations[action])
  const request = {
    productCode: code, tenant: user.tenant, deployment: user.deployment,
    authorization: { resource: 'product_documents', action: 'view', facts, expires_at: enterpriseRuntimePermitExpiresAt() },
    query
  }
  const result = await callEnterpriseRuntime<RuntimeResponse>(event, operations[action], request)
  if (result.code !== 0 || !result.data || result.data.product_code !== code || result.data.workspace_revision !== facts.revision) throw createError({ statusCode: 503, message: '产品文档响应无效' })
  if (action !== 'content') {
    const pageQuery = query as { page: number, pageSize: number, removed?: boolean }
    const current = await requireDocumentsAccess(event, code)
    if (current.actor_uid !== facts.actor_uid || current.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新' })
    const data = result.data
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || typeof data.total !== 'number' || data.total < 0 || data.page !== pageQuery.page || data.pageSize !== pageQuery.pageSize) throw createError({ statusCode: 503, message: '产品文档列表响应无效' })
    const items = data.items.map((value: unknown) => {
      const row = value as Record<string, unknown>
      if (action === 'requests') {
        if (!uuid(row?.biz_id) || typeof row.purpose !== 'string' || typeof row.status !== 'string' || typeof row.linked !== 'boolean') throw createError({ statusCode: 503, message: '产品文档申请响应无效' })
        return { biz_id: row.biz_id, purpose: row.purpose, status: row.status, linked: row.linked }
      }
      const metadata = row?.metadata as Record<string, unknown> | undefined
      if (!uuid(row?.biz_id) || row.product_code !== code || !uuid(row.document_uuid) || row.removed !== pageQuery.removed || typeof row.purpose !== 'string' || !metadata || metadata.uuid !== row.document_uuid || typeof metadata.title !== 'string' || typeof metadata.doc_type !== 'string' || typeof metadata.updated_at !== 'string') throw createError({ statusCode: 503, message: '产品文档列表响应无效' })
      return { biz_id: row.biz_id, document_uuid: row.document_uuid, purpose: row.purpose, metadata: { uuid: metadata.uuid, title: metadata.title, doc_type: metadata.doc_type, updated_at: metadata.updated_at } }
    })
    const edit = action === 'list' ? await checkProductPermission(event, code, 'product_documents', 'edit', await enterpriseProductAuthorizationSource(event)) : undefined
    return { code: 0, data: { product_code: code, workspace_revision: data.workspace_revision, canEdit: edit?.allowed === true, items, total: data.total, page: data.page, pageSize: data.pageSize } }
  }
  const doc = result.data.document as Record<string, unknown> | undefined
  if (result.data.relation_biz_id !== query.bizId || !doc || !uuid(doc.uuid) || typeof doc.oss_path !== 'string' || !doc.oss_path) throw createError({ statusCode: 503, message: '文档正文响应无效' })
  const loaded = await withEnterpriseCodocsDocumentContent(event, { success: true, data: doc }, doc.uuid, false)
  const fresh = await requireDocumentsAccess(event, code)
  if (fresh.actor_uid !== facts.actor_uid || fresh.revision !== facts.revision) throw createError({ statusCode: 409, message: '产品文档授权已变化，请刷新' })
  const latest = await callEnterpriseRuntime<RuntimeResponse>(event, operations.content, { ...request, authorization: { ...request.authorization, facts: fresh, expires_at: enterpriseRuntimePermitExpiresAt() } })
  const latestDocument = latest.data?.document as Record<string, unknown> | undefined
  if (latest.code !== 0 || latest.data?.workspace_revision !== result.data.workspace_revision || latest.data?.relation_biz_id !== query.bizId || latestDocument?.uuid !== doc.uuid || latestDocument?.oss_path !== doc.oss_path || latestDocument?.updated_at !== doc.updated_at) throw createError({ statusCode: 409, message: '文档关联或正文已变化，请刷新' })
  const content = loaded.data as Record<string, unknown>
  return { code: 0, data: { uuid: doc.uuid, title: content.title, docType: content.doc_type, updatedAt: content.updated_at, content: content.content } }
}
