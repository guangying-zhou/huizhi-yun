import { checkCodocsDocumentAccess } from '~~/server/utils/codocsApi'
import { getProjectDocumentContext } from '~~/server/utils/projectDocumentAccess'

type DocumentAccessAction = 'view' | 'download' | 'edit'

function normalizeDocumentAccessAction(value: unknown): DocumentAccessAction {
  const action = String(value || 'view').trim()
  if (action === 'view' || action === 'download' || action === 'edit') {
    return action
  }
  throw createError({ statusCode: 400, message: '无效的文档权限动作' })
}

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

  const body = await readBody<{ action?: unknown }>(event)
  const action = normalizeDocumentAccessAction(body?.action)

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)
  const result = await checkCodocsDocumentAccess({
    event,
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
    sourceProjectCode: context.projectCode,
    action,
    actorUid: uid,
    actorProjectCodes: context.actorProjectCodes,
    actorDeptCodes: context.actorDeptCodes,
    actorRoles: context.actorRoles
  })

  return {
    code: 0,
    data: result
  }
})
