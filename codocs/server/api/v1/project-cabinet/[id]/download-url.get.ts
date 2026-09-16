import { getSignedUrl } from '~~/server/utils/oss'
import { getProjectCabinetFile } from '~~/server/utils/projectCabinetService'
import { AIMS_PROJECT_CABINET_READ_SERVICE_AUTH, requireAimsProjectCabinetServiceAuth } from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  await requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const query = getQuery(event)
  const projectCode = String(query.project_code || query.projectCode || '').trim()
  const expectedOssPath = String(query.expected_oss_path || query.expectedOssPath || '').trim()
  if (!projectCode) {
    throw createError({ statusCode: 400, message: '项目编码不能为空' })
  }

  const file = await getProjectCabinetFile(event, id, projectCode, expectedOssPath)
  const encodedFilename = encodeURIComponent(file.original_name)
  const signedUrl = await getSignedUrl(file.oss_path, 300, {
    'content-disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
  })

  return {
    code: 0,
    data: {
      url: signedUrl,
      uuid: file.uuid,
      originalName: file.original_name,
      fileExt: file.file_ext,
      fileSize: file.file_size,
      ossPath: file.oss_path,
      projectCode: file.project_code || projectCode
    }
  }
})
