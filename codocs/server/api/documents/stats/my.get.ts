/**
 * 当前用户文档统计
 * GET /api/documents/stats/my
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface DocumentStats {
  myDocumentCount: number
  myTotalSize: number
  allDocumentCount: number
  allTotalSize: number
  countRatio: number
  sizeRatio: number
  byType?: Array<{
    doc_type?: string
    docType?: string
    count?: number
    size?: number
  }>
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const data = await callCodocsTenantRuntime<DocumentStats>(event, '/v1/codocs/documents/stats/my', {
    query: {
      actorUid: uid,
      current_user: uid
    },
    scope: 'codocs.read'
  })

  return {
    code: 0,
    data
  }
})
