import { getCodocsDocumentAccessPolicy } from '~~/server/utils/codocsApi'
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

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)

  const policy = await getCodocsDocumentAccessPolicy({
    event,
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
    sourceProjectCode: context.projectCode,
    operatorUid: uid
  })

  return {
    code: 0,
    data: policy
  }
})
