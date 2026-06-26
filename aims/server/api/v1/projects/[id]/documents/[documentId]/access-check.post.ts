import { checkCodocsDocumentAccess } from '~~/server/utils/codocsApi'
import { getProjectDocumentContext } from '~~/server/utils/projectDocumentAccess'

function projectMemberFallbackAccess(
  context: Awaited<ReturnType<typeof getProjectDocumentContext>>,
  action: 'view' | 'download' | 'edit'
) {
  if (!context.isMember) return null

  return {
    allowed: true,
    readonly: action === 'edit',
    reason: 'project_member_direct',
    permission: action === 'download' ? 'download' : 'view',
    lifecycleStage: 'draft',
    confidentialityLevel: 'L2'
  }
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

  const body = await readBody<{ action?: 'view' | 'download' | 'edit' }>(event)
  const action = body?.action || 'view'

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)
  let result
  try {
    result = await checkCodocsDocumentAccess({
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
  } catch (error) {
    const fallback = projectMemberFallbackAccess(context, action)
    if (!fallback) throw error

    return {
      code: 0,
      data: fallback
    }
  }

  if (!result.allowed) {
    const fallback = projectMemberFallbackAccess(context, action)
    if (fallback) {
      return {
        code: 0,
        data: fallback
      }
    }
  }

  return {
    code: 0,
    data: result
  }
})
