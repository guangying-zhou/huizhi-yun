/**
 * 获取单个用户详情
 * 路由: GET /api/account/users/[uid]
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

  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: 'Uid is required' })
  }

  try {
    const response = await $fetch<ApiResponse<unknown>>(
      `${apiBaseUrl}/api/v1/users/${encodeURIComponent(uid)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` },
        timeout: 5000
      }
    )
    return response
  } catch (error) {
    const accountError = error as { message?: string, statusCode?: number }
    console.error(`[AccountApi] Failed to fetch user ${uid}:`, accountError.message || error)
    throw createError({
      statusCode: accountError.statusCode || 500,
      message: accountError.message || 'Failed to fetch user from Account API'
    })
  }
})
