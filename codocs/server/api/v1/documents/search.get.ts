/**
 * 搜索文档
 * GET /api/v1/documents/search
 *
 * 供其他模块调用，需 Console service token
 * 支持按关键词、文档类型、项目编码、部门、所有者等条件搜索
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface DocumentRow {
  uuid: string
  title: string
  doc_type: string
  owner_uid: string
  dept_code: string | null
  project_code: string | null
  content_size: number
  ai_abstract: string | null
  updated_at: string
}

interface RuntimeSearchResult {
  items: DocumentRow[]
  total: number
  page: number
  pageSize: number
}

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:read'] })

  const query = getQuery(event)
  const keyword = (query.keyword as string || '').trim()
  const docType = query.doc_type as string || ''
  const projectCode = query.project_code as string || ''
  const deptCode = query.dept_code as string || ''
  const ownerUid = query.owner_uid as string || ''
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20))
  const result = await callCodocsTenantRuntime<RuntimeSearchResult>(event, '/v1/codocs/documents/search', {
    scope: 'codocs.read',
    query: {
      keyword,
      doc_type: docType,
      project_code: projectCode,
      dept_code: deptCode,
      owner_uid: ownerUid,
      page,
      page_size: pageSize
    }
  })

  return {
    code: 0,
    data: {
      items: result.items.map(row => ({
        uuid: row.uuid,
        title: row.title,
        docType: row.doc_type,
        ownerUid: row.owner_uid,
        deptCode: row.dept_code,
        projectCode: row.project_code,
        contentSize: row.content_size,
        aiAbstract: row.ai_abstract,
        updatedAt: row.updated_at
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    }
  }
})
