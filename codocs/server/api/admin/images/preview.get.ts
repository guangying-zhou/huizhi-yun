import { createError, getQuery, setHeader } from 'h3'
import { downloadImageBuffer, getImageContentTypeForPath } from '~~/server/utils/oss'
import { requirePermission } from '~~/server/utils/checkPermission'
import { normalizeCodocsUserImageObjectPath } from '~~/server/utils/ossImagePath'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin', '仅管理员可预览清理图片')

  const path = normalizeCodocsUserImageObjectPath(getQuery(event).path)

  const content = await downloadImageBuffer(path)
  if (!content) {
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  setHeader(event, 'Content-Type', getImageContentTypeForPath(path) || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'private, max-age=300')
  return content
})
