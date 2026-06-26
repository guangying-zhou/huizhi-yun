/**
 * OSS头像代理API
 * 路由: GET /api/oss/avatar?path=xxx
 */
import OSS from 'ali-oss'
import { getOssIntegrationConfig } from '@hzy/foundation/server/utils/ossIntegration'

function normalizeOssEndpoint(endpoint: string) {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const avatarPath = query.path as string

  if (!avatarPath) {
    throw createError({ statusCode: 400, message: 'Missing avatar path' })
  }

  const objectPath = `avatars/${avatarPath}`

  try {
    const oss = await getOssIntegrationConfig()
    const client = new OSS({
      region: oss.region || undefined,
      accessKeyId: oss.accessKeyId,
      accessKeySecret: oss.accessKeySecret,
      bucket: oss.bucket,
      endpoint: normalizeOssEndpoint(oss.endpoint)
    })

    const result = await client.get(objectPath)

    const headers = result.res.headers as Record<string, string>
    const contentType = headers['content-type'] || 'image/png'
    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')

    return result.content
  } catch (error: unknown) {
    const err = error as { code?: string, message?: string }
    console.error('[OSS Avatar] Error fetching avatar:', err.message || error)

    if (err.code === 'NoSuchKey') {
      throw createError({ statusCode: 404, message: 'Avatar not found' })
    }

    throw createError({ statusCode: 500, message: 'Failed to fetch avatar' })
  }
})
