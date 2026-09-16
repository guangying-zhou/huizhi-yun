import { listCodocsDocumentAccessAuditLogs } from '~~/server/utils/codocsApi'
import { getProjectDocumentContext } from '~~/server/utils/projectDocumentAccess'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  const documentId = Number(getRouterParam(event, 'documentId'))
  if (!projectId || Number.isNaN(projectId) || !documentId || Number.isNaN(documentId)) {
    throw createError({ statusCode: 400, message: '无效的项目或文档 ID' })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)
  if (!context.isMember) {
    throw createError({ statusCode: 403, message: '仅项目成员可查看访问审计' })
  }

  const result = await listCodocsDocumentAccessAuditLogs({
    event,
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
    sourceProjectCode: context.projectCode,
    page,
    pageSize
  })

  return {
    code: 0,
    data: result
  }
})
