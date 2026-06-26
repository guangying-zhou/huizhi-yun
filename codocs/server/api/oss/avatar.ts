/**
 * OSS头像代理API
 * 从私有Aliyun OSS bucket读取用户头像，或代理到Account系统
 * 路由: GET /api/oss/avatar?path=xxx
 */
import { createOSSClient } from '../../utils/oss'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const avatarPath = query.path as string

  if (!avatarPath) {
    throw createError({
      statusCode: 400,
      message: 'Missing avatar path'
    })
  }

  console.log('[OSS Avatar] Requested path:', avatarPath)

  let objectPath = avatarPath
  if (avatarPath) {
    // 头像存储在 OSS 的 avatars/ 目录下
    objectPath = `avatars/${avatarPath}`
    console.log('[OSS Avatar] Extracted avatar filename, OSS path:', objectPath)
  }

  try {
    const client = createOSSClient()

    console.log('[OSS Avatar] Fetching from OSS, path:', objectPath)

    // 获取对象
    const result = await client.get(objectPath)

    // 设置响应头
    const headers = result.res.headers as Record<string, string>
    const contentType = headers['content-type'] || 'image/png'
    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400') // 缓存1天

    return result.content
  } catch (err: unknown) {
    const error = err as { code?: string, message?: string }
    // 头像不存在是正常业务场景（用户未上传头像），返回默认占位图
    if (error.code === 'NoSuchKey') {
      console.warn('[OSS Avatar] Avatar not found in OSS:', objectPath)
      // 返回 1x1 透明 PNG 作为默认头像，避免前端报错
      setHeader(event, 'Content-Type', 'image/png')
      setHeader(event, 'Cache-Control', 'public, max-age=3600')
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
