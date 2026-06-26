import { checkCodocsDocumentAccess, getCodocsHomeOrigin } from '~~/server/utils/codocsApi'
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

  const access = await checkCodocsDocumentAccess({
    event,
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
    sourceProjectCode: context.projectCode,
    action: 'download',
    actorUid: uid,
    actorProjectCodes: context.actorProjectCodes,
    actorDeptCodes: context.actorDeptCodes,
    actorRoles: context.actorRoles
  })

  if (!access.allowed) {
    throw createError({ statusCode: 403, message: '无权下载该文档' })
  }

  if (context.documentRefType !== 'cabinet_file') {
    throw createError({ statusCode: 400, message: '当前文档不支持文件柜下载' })
  }

  const codocsHome = await getCodocsHomeOrigin()
  const target = `${codocsHome}/api/dept-cabinet/${encodeURIComponent(context.documentUuid)}/download`
  return sendRedirect(event, target)
})
