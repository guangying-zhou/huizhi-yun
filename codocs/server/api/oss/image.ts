/**
 * OSS Image Proxy API
 * 从私有Aliyun OSS bucket读取图片
 * 路由: GET /api/oss/image?path=xxx
 */
import { downloadImageBuffer, getImageContentTypeForPath } from '../../utils/oss'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const imagePath = query.path as string

  if (!imagePath) {
    throw createError({
      statusCode: 400,
      message: 'Missing image path'
    })
  }

  // console.log('[OSS Image] Requested path:', imagePath)

  try {
    const content = await downloadImageBuffer(imagePath)
    if (!content) {
      throw createError({
        statusCode: 404,
        message: 'Image not found'
      })
    }

    // 设置响应头
    setHeader(event, 'Content-Type', getImageContentTypeForPath(imagePath) || 'image/jpeg')
    setHeader(event, 'Cache-Control', 'public, max-age=86400') // 缓存1天

    return content
  } catch (err: unknown) {
    const error = err as { code?: string, message?: string, statusCode?: number }
    const message = error.message || String(err)
    if (error.statusCode === 404) {
      throw err
    }

    if (message.includes('OSS credentials not configured') || message.includes('Images OSS credentials not configured')) {
      setHeader(event, 'Cache-Control', 'no-store')
      throw createError({
        statusCode: 404,
        message: 'OSS image storage is not configured'
      })
    }

    // 如果文件不存在，返回404
    if (error.code === 'NoSuchKey') {
      throw createError({
        statusCode: 404,
        message: 'Image not found'
      })
    }

    console.error('[OSS Image] Error fetching image:', message)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch image'
    })
  }
})
