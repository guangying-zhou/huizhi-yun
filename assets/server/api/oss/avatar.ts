/**
 * OSS头像代理API
 * 路由: GET /api/oss/avatar?path=xxx
 */
import { getOssObjectStorageClient } from '@hzy/foundation/server/utils/ossIntegration'

const ALLOWED_AVATAR_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])
const AVATAR_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/

function queryText(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

function normalizeAvatarObjectPath(value: unknown) {
  const rawPath = queryText(value)
  if (!rawPath) {
    throw createError({ statusCode: 400, message: 'Missing avatar path' })
  }
  if (rawPath.length > 200 || rawPath.startsWith('/') || rawPath.includes('\\')) {
    throw createError({ statusCode: 400, message: 'Invalid avatar path' })
  }

  const segments = rawPath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !AVATAR_SEGMENT_PATTERN.test(segment))) {
    throw createError({ statusCode: 400, message: 'Invalid avatar path' })
  }

  const fileName = segments.at(-1) || ''
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : ''
  if (!extension || !ALLOWED_AVATAR_EXTENSIONS.has(extension)) {
    throw createError({ statusCode: 400, message: 'Invalid avatar file type' })
  }

  return segments.join('/')
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const normalizedAvatarPath = normalizeAvatarObjectPath(query.path)
  const objectPath = `avatars/${normalizedAvatarPath}`

  try {
    const client = await getOssObjectStorageClient()
    const result = await client.get(objectPath)

    const headers = result.res.headers as Record<string, string>
    const contentType = headers['content-type'] || 'image/png'
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw createError({ statusCode: 415, message: 'Avatar object is not an image' })
    }
    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')

    return result.content
  } catch (error: unknown) {
    const err = error as { code?: string, message?: string, statusCode?: number }
    if (err.statusCode) throw error
    console.error('[OSS Avatar] Error fetching avatar:', err.message || error)

    if (err.code === 'NoSuchKey') {
      throw createError({ statusCode: 404, message: 'Avatar not found' })
    }

    throw createError({ statusCode: 500, message: 'Failed to fetch avatar' })
  }
})
