/**
 * Prepare Codocs iframe preview access for an AIMS project document.
 * POST /api/v1/codocs/documents/:uuid/preview-access
 */
import { ensureCodocsDocumentPreviewAccess } from '~~/server/utils/codocsApi'
import { assertCodocsProjectDocumentAccess } from '~~/server/utils/projectDocumentAccess'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const uuid = String(getRouterParam(event, 'uuid') || '').trim()
  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }

  const body = await readBody<{ projectId?: number | string, project_id?: number | string }>(event)
  const projectId = Number(body.projectId ?? body.project_id) || 0
  if (!projectId) {
    throw createError({ statusCode: 400, message: '缺少项目 ID' })
  }

  const context = await assertCodocsProjectDocumentAccess(event, projectId, uuid, uid)
  if (!context.projectCode) {
    throw createError({ statusCode: 400, message: '项目缺少项目编码，无法准备文档预览权限' })
  }
  const access = await ensureCodocsDocumentPreviewAccess({
    event,
    documentUuid: uuid,
    actorUid: uid,
    sourceProjectCode: context.projectCode
  })

  return {
    code: 0,
    data: {
      uuid,
      title: context.title,
      access
    }
  }
})
