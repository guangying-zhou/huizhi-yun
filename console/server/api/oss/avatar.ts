import { getConsoleOSSAvatar } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

const ALLOWED_AVATAR_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])
const AVATAR_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/

function queryText(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

function normalizeAvatarObjectPath(value: unknown) {
  const rawPath = queryText(value)
  if (!rawPath) {
    throw createError({
      statusCode: 400,
      message: 'Missing avatar path'
    })
  }
  if (rawPath.length > 200 || rawPath.startsWith('/') || rawPath.includes('\\')) {
    throw createError({
      statusCode: 400,
      message: 'Invalid avatar path'
    })
  }

  const segments = rawPath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !AVATAR_SEGMENT_PATTERN.test(segment))) {
    throw createError({
      statusCode: 400,
      message: 'Invalid avatar path'
    })
  }

  const fileName = segments.at(-1) || ''
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : ''
  if (!extension || !ALLOWED_AVATAR_EXTENSIONS.has(extension)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid avatar file type'
    })
  }

  return segments.join('/')
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const normalizedAvatarPath = normalizeAvatarObjectPath(query.path)
  const objectPath = `avatars/${normalizedAvatarPath}`

  try {
    const runtime = await getConsoleOSSAvatar(event, {
      integrationCode: process.env.HZY_OSS_INTEGRATION_CODE || 'oss.default',
      objectPath
    })
    const contentType = String(runtime.data.contentType || '').trim()
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw createError({ statusCode: 415, message: 'Avatar object is not an image' })
    }
    const content = Buffer.from(runtime.data.contentBase64, 'base64')

    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    if (runtime.data.etag) {
      setHeader(event, 'ETag', runtime.data.etag)
    }

    return content
  } catch (err: unknown) {
    const error = err as { statusCode?: number }
    if (error.statusCode) throw err

    throw createError({
      statusCode: 500,
      statusMessage: 'AVATAR_FETCH_FAILED',
      message: 'Failed to fetch avatar'
    })
  }
})
