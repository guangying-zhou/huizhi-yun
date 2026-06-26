import { createError, getQuery, setHeader } from 'h3'
import { downloadImageBuffer, getImageContentTypeForPath } from '~~/server/utils/oss'

const IMAGE_PATH_PATTERN = /^codocs\/users\/[^/]+\/images\/[^/]+\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|pic|tiff|tif|heic|heif|avif)$/i

export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path || '')
  if (!IMAGE_PATH_PATTERN.test(path)) {
    throw createError({ statusCode: 400, message: 'Invalid image path' })
  }

  const content = await downloadImageBuffer(path)
  if (!content) {
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  setHeader(event, 'Content-Type', getImageContentTypeForPath(path) || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'private, max-age=300')
  return content
})
