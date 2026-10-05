import { getFromOSS } from '../../utils/oss'

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path')

  if (!path) {
    throw createError({
      statusCode: 400,
      message: 'Missing path parameter'
    })
  }

  try {
    // Decode the path (it may be URL encoded)
    const decodedPath = decodeURIComponent(path)
    console.log('Decoded path:', decodedPath)
    const ossPath = `avatars/${decodedPath}`

    const { content, contentType } = await getFromOSS(ossPath)

    // Set appropriate headers
    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400') // Cache for 1 day

    return content
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('Failed to get avatar:', error)
    throw createError({
      statusCode: 404,
      message: 'Avatar not found'
    })
  }
})
