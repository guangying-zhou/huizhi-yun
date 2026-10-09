import { verifyApiKey } from '~~/server/utils/api-auth'

defineRouteMeta({
  openAPI: {
    tags: ['认证'],
    summary: '验证 API Key',
    description: '验证 Authorization Header 中的 API Key 是否有效，可用于连通性测试。'
  }
})

export default defineEventHandler(async (event) => {
  try {
    // Verify API key - if successful, the key is valid
    const keyRecord = await verifyApiKey(event)

    return {
      code: 0,
      message: 'Token is valid',
      data: {
        valid: true,
        keyId: keyRecord.id,
        rateLimit: keyRecord.rate_limit
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    // Return structured error for invalid token
    return {
      code: error.statusCode || 500,
      message: error.message || 'Token verification failed',
      data: {
        valid: false
      }
    }
  }
})
