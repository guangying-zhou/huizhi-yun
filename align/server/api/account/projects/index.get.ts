/**
 * 获取项目列表
 * 路由: GET /api/account/git-projects
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

  const query = getQuery(event)

  try {
    const response = await $fetch<ApiResponse<unknown>>(
      `${apiBaseUrl}/api/v1/projects`,
      {
        headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` },
        params: query,
        timeout: 10000
      }
    )
    return response
  } catch (error) {
    const accountError = error as { message?: string, statusCode?: number }
    console.error('[AccountApi] Failed to fetch git_projects:', accountError.message || error)
    throw createError({
      statusCode: accountError.statusCode || 500,
      message: accountError.message || 'Failed to fetch git_projects from Account API'
    })
  }
})
