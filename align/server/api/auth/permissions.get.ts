/**
 * 获取当前用户权限（代理 Account API）
 * GET /api/auth/permissions
 */
import { $fetch as ofetch } from 'ofetch'

interface PermissionsResponse {
  code: number
  data: {
    uid: string
    roles: string[]
    resources: Record<string, unknown>
  }
}

export default defineEventHandler(async (event): Promise<PermissionsResponse> => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const config = useRuntimeConfig()
  const { hzy = {} } = config as { hzy?: { apiBaseUrl?: string, apiKey?: string, apiSecret?: string } }
  const { apiBaseUrl, apiKey, apiSecret } = hzy

  if (!apiBaseUrl || !apiKey || !apiSecret) {
    return {
      code: 0,
      data: { uid, roles: [], resources: {} }
    }
  }

  try {
    const response = await ofetch<PermissionsResponse>(
      `${apiBaseUrl}/api/v1/users/${encodeURIComponent(uid)}/permissions`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}:${apiSecret}`
        },
        timeout: 5000
      }
    )

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Auth Permissions] Failed to fetch from Account:', message)
    return {
      code: 0,
      data: { uid, roles: [], resources: {} }
    }
  }
})
