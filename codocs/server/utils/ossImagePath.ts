import { createError } from 'h3'

const IMAGE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/
const ALLOWED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pic', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg'])
const USER_IMAGE_PATH_PATTERN = /^codocs\/users\/[^/]+\/images\/[^/]+\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|pic|tiff|tif|heic|heif|avif)$/i

function queryText(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

export function normalizeImageObjectPath(value: unknown, message = 'Invalid image path') {
  const rawPath = queryText(value)
  if (!rawPath) {
    throw createError({
      statusCode: 400,
      message: 'Missing image path'
    })
  }
  if (rawPath.length > 500 || rawPath.startsWith('/') || rawPath.includes('\\')) {
    throw createError({
      statusCode: 400,
      message
    })
  }

  const segments = rawPath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !IMAGE_SEGMENT_PATTERN.test(segment))) {
    throw createError({
      statusCode: 400,
      message
    })
  }

  const fileName = segments.at(-1) || ''
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : ''
  if (!extension || !ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid image file type'
    })
  }

  return segments.join('/')
}

export function normalizeCodocsUserImageObjectPath(value: unknown) {
  const path = normalizeImageObjectPath(value)
  if (!USER_IMAGE_PATH_PATTERN.test(path)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid image path'
    })
  }
  return path
}
