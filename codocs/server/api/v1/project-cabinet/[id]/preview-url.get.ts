import { getSignedUrl } from '~~/server/utils/oss'
import { getProjectCabinetFile } from '~~/server/utils/projectCabinetService'
import { AIMS_PROJECT_CABINET_READ_SERVICE_AUTH, requireAimsProjectCabinetServiceAuth } from '~~/server/utils/serviceAuthGuard'
import { CABINET_TEXT_PREVIEW_EXTENSIONS, readCabinetTextPreview } from '~~/server/utils/cabinetTextPreview'

const DIRECT_PREVIEW_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'mp4',
  'mp3',
  'wav'
])

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
  const fileExt = String(file.file_ext || '').trim().toLowerCase()
  if (!DIRECT_PREVIEW_EXTENSIONS.has(fileExt) && !CABINET_TEXT_PREVIEW_EXTENSIONS.has(fileExt)) {
    return {
      code: 0,
      data: {
        previewable: false,
        previewType: 'download',
        uuid: file.uuid,
        originalName: file.original_name,
        fileExt,
        fileSize: file.file_size,
        ossPath: file.oss_path,
        projectCode: file.project_code || projectCode
      }
    }
  }

  if (CABINET_TEXT_PREVIEW_EXTENSIONS.has(fileExt)) {
    const textPreview = await readCabinetTextPreview(event, file.oss_path)
    return {
      code: 0,
      data: {
        previewable: true,
        previewType: 'text',
        content: textPreview.content,
        encoding: textPreview.encoding,
        truncated: textPreview.truncated,
        uuid: file.uuid,
        originalName: file.original_name,
        fileExt,
        fileSize: file.file_size,
        ossPath: file.oss_path,
        projectCode: file.project_code || projectCode
      }
    }
  }

  const encodedFilename = encodeURIComponent(file.original_name)
  const signedUrl = await getSignedUrl(file.oss_path, 300, {
    'content-disposition': `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
  })

  return {
    code: 0,
    data: {
      previewable: true,
      previewType: 'direct',
      previewUrl: signedUrl,
      uuid: file.uuid,
      originalName: file.original_name,
      fileExt,
      fileSize: file.file_size,
      ossPath: file.oss_path,
      projectCode: file.project_code || projectCode
    }
  }
})
