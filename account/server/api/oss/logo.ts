/**
 * OSS Logo 代理接口
 * 从 Aliyun OSS 读取应用 Logo 并代理返回
 * 路由: GET /api/oss/logo?path=logos/xxx.png
 */
import OSS from 'ali-oss'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const logoPath = query.path as string

  if (!logoPath) {
    throw createError({ statusCode: 400, message: 'Missing path parameter' })
  }

  // 安全检查：只允许访问 logos/ 目录
  const decodedPath = decodeURIComponent(logoPath)
  if (!decodedPath.startsWith('logos/')) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const config = useRuntimeConfig()
  const ossConfig = config.ossImages as {
    bucketName: string
    endpoint: string
    accessKeyId: string
    accessKeySecret: string
    region: string
  }

  if (!ossConfig.bucketName || !ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
    throw createError({ statusCode: 500, message: 'OSS not configured' })
  }

  try {
    const client = new OSS({
      region: ossConfig.region,
      accessKeyId: ossConfig.accessKeyId,
      accessKeySecret: ossConfig.accessKeySecret,
      bucket: ossConfig.bucketName,
      endpoint: `https://${ossConfig.endpoint}`
    })

    const result = await client.get(decodedPath)
    const headers = result.res.headers as Record<string, string>
    const contentType = headers['content-type'] || 'image/png'

    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')

    return result.content
  } catch (err: unknown) {
    const error = err as { code?: string, message?: string }
    console.error('[OSS Logo] 获取失败:', error.message)

    if (error.code === 'NoSuchKey') {
      throw createError({ statusCode: 404, message: 'Logo not found' })
    }
    throw createError({ statusCode: 500, message: 'Failed to fetch logo' })
  }
})
