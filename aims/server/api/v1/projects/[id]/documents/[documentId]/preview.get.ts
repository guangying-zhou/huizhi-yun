import { checkCodocsDocumentAccess, getCodocsProjectCabinetPreviewUrl } from '~~/server/utils/codocsApi'
import { getProjectDocumentContext } from '~~/server/utils/projectDocumentAccess'

function stringValue(value: unknown) {
  return String(value || '').trim()
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

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)
  const access = await checkCodocsDocumentAccess({
    event,
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
    sourceProjectCode: context.projectCode,
    action: 'view',
    actorUid: uid,
    actorProjectCodes: context.actorProjectCodes,
    actorDeptCodes: context.actorDeptCodes,
    actorRoles: context.actorRoles
  })

  if (!access.allowed) {
    throw createError({ statusCode: 403, message: '无权预览该文档' })
  }

  if (context.documentRefType !== 'cabinet_file') {
    throw createError({ statusCode: 400, message: '当前文档不支持文件柜预览' })
  }
  if (!context.projectCode) {
    throw createError({ statusCode: 500, message: '项目编码缺失，无法预览项目文件' })
  }

  const expectedOssPath = stringValue(
    context.document.ossPath
    ?? context.document.oss_path
    ?? context.document.repoFilePath
    ?? context.document.repo_file_path
  )
  const preview = await getCodocsProjectCabinetPreviewUrl({
    event,
    fileUuid: context.documentUuid,
    projectCode: context.projectCode,
    expectedOssPath
  })

  return {
    code: 0,
    data: {
      ...preview,
      access
    }
  }
})
