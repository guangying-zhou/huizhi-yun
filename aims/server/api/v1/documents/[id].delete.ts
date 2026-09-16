/**
 * 删除文档/文件夹
 * DELETE /api/v1/documents/:id
 * 如果是文件夹，由 data-runtime/数据库外键级联删除子文档
 */
import { deleteCodocsProjectCabinetFile } from '~~/server/utils/codocsApi'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { callAimsRuntime, requireProjectDocumentDeleteAccess } from '~~/server/utils/projectDocumentAccess'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少文档 ID' })
  }

  const docId = Number(id)
  if (!Number.isFinite(docId) || docId <= 0) {
    throw createError({ statusCode: 400, message: '无效的文档 ID' })
  }
  const { context } = await requireProjectDocumentDeleteAccess(
    event,
    docId,
    uid,
    '仅项目经理或上传人可以删除项目文档'
  )
  const cabinetFileDelete = await deleteProjectCabinetBackingFile(event, context)

  const result = await callAimsRuntime<Record<string, unknown>>(
    event,
    `/v1/aims/documents/${encodeURIComponent(String(docId))}`,
    {
      method: 'DELETE',
      query: await buildAimsProjectListRuntimeAccessQuery(event, {
        uid,
        baseQuery: { operator_uid: uid }
      }),
      scope: 'aims.write'
    }
  )

  return {
    code: 0,
    message: '删除成功',
    data: result && typeof result === 'object'
      ? { ...result, cabinetFileDelete }
      : { result, cabinetFileDelete }
  }
})

async function deleteProjectCabinetBackingFile(
  event: Parameters<typeof deleteCodocsProjectCabinetFile>[0]['event'],
  context: Awaited<ReturnType<typeof requireProjectDocumentDeleteAccess>>['context']
) {
  const isFolder = booleanValue(context.document.isFolder ?? context.document.is_folder)
  if (isFolder || context.documentRefType !== 'cabinet_file') return null

  const expectedOssPath = stringValue(
    context.document.ossPath
    ?? context.document.oss_path
    ?? context.document.repoFilePath
    ?? context.document.repo_file_path
  )
  if (!isProjectCabinetOssPath(expectedOssPath)) return null
  if (!context.projectCode) {
    throw createError({ statusCode: 500, message: '项目编码缺失，无法删除项目文件' })
  }

  return await deleteCodocsProjectCabinetFile({
    event,
    fileUuid: context.documentUuid,
    projectCode: context.projectCode,
    expectedOssPath
  })
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || stringValue(value) === '1'
}

function isProjectCabinetOssPath(value: string) {
  return /^codocs\/projects\/[^/]+\/cabinet\/[^/]+/.test(value)
}
