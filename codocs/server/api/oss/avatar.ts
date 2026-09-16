/**
 * OSS头像代理API
 * 从私有Aliyun OSS bucket读取用户头像，或代理到Account系统
 * 路由: GET /api/oss/avatar?path=xxx
 */
import { createOSSClient } from '../../utils/oss'

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
    const client = createOSSClient()

    console.log('[OSS Avatar] Fetching from OSS, path:', objectPath)

    // 获取对象
    const result = await client.get(objectPath)

    // 设置响应头
    const headers = result.res.headers as Record<string, string>
    const contentType = headers['content-type'] || 'image/png'
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw createError({ statusCode: 415, message: 'Avatar object is not an image' })
    }
    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400') // 缓存1天
    setHeader(event, 'X-Content-Type-Options', 'nosniff')

    return result.content
  } catch (err: unknown) {
    const error = err as { code?: string, message?: string, statusCode?: number }
    if (error.statusCode) throw err
    // 头像不存在是正常业务场景（用户未上传头像），返回默认占位图
    if (error.code === 'NoSuchKey') {
      console.warn('[OSS Avatar] Avatar not found in OSS:', objectPath)
      // 返回 1x1 透明 PNG 作为默认头像，避免前端报错
      setHeader(event, 'Content-Type', 'image/png')
      setHeader(event, 'Cache-Control', 'public, max-age=3600')
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
      const transparentPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRElEQkSuQmCC',
        'base64'
      )
      return transparentPng
    }

    console.error('[OSS Avatar] Error fetching avatar:', error.message || err)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch avatar'
    })
  }
})
