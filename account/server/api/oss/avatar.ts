/**
 * OSS头像代理API
 * 从私有Aliyun OSS bucket读取用户头像，或代理到Account系统
 * 路由: GET /api/oss/avatar?path=xxx
 */
import OSS from 'ali-oss'

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

  // 否则从 OSS 读取
  const config = useRuntimeConfig()
  const { bucketName, endpoint, accessKeyId, accessKeySecret, region } = config.oss as {
    bucketName: string
    endpoint: string
    accessKeyId: string
    accessKeySecret: string
    region: string
  }

  if (!bucketName || !accessKeyId || !accessKeySecret) {
    throw createError({
      statusCode: 500,
      message: 'OSS not configured'
    })
  }

  try {
    const client = new OSS({
      region,
      accessKeyId,
      accessKeySecret,
      bucket: bucketName,
      endpoint: `https://${endpoint}`
    })

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
    console.error('[OSS Avatar] Error fetching avatar:', error.message || error)

    // 如果文件不存在，返回404
    if (error.code === 'NoSuchKey') {
      throw createError({
        statusCode: 404,
        message: 'Avatar not found'
      })
    }

    throw createError({
      statusCode: 500,
      message: 'Failed to fetch avatar'
    })
  }
})
