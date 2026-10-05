/**
 * 批量获取用户
 * 路由: POST /api/account/users/batch
 */
import type { ApiResponse } from '~/types/account'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { apiBaseUrl, apiKey, apiSecret } = config.hzy as {
    apiBaseUrl: string
    apiKey: string
    apiSecret: string
  }

  if (!apiKey || !apiSecret) {
    throw createError({ statusCode: 500, message: 'Account API configuration is missing' })
  }

  const body = await readBody<{ uids?: unknown }>(event)

  if (!body.uids || !Array.isArray(body.uids)) {
    throw createError({ statusCode: 400, message: 'uids array is required' })
  }

  try {
    const response = await $fetch<ApiResponse<unknown>>(
      `${apiBaseUrl}/api/v1/users/batch`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}:${apiSecret}`,
          'Content-Type': 'application/json'
        },
        body: { uids: body.uids },
        timeout: 10000
      }
    )
    return response
  } catch (error) {
    const accountError = error as { message?: string, statusCode?: number }
    console.error('[AccountApi] Failed to batch fetch users:', accountError.message || error)
    throw createError({
      statusCode: accountError.statusCode || 500,
      message: accountError.message || 'Failed to batch fetch users from Account API'
    })
  }
})
