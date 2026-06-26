/**
 * 服务端权限检查工具
 */
import type { H3Event } from 'h3'

/**
 * 检查当前请求用户是否拥有指定权限
 */
export async function checkPermission(
  event: H3Event,
  resource: string,
  action: 'view' | 'edit' | 'admin' = 'admin'
): Promise<boolean> {
  const uid = getCookie(event, 'auth_user')
  if (!uid) return false

  const config = useRuntimeConfig()
  const appCode = String(config.public?.appCode || config.public?.appName || 'align')
  const { apiBaseUrl, apiKey, apiSecret } = (config as {
    hzy?: {
      apiBaseUrl?: string
      apiKey?: string
      apiSecret?: string
    }
  }).hzy || {}
  if (!apiBaseUrl || !apiKey || !apiSecret) return false

  try {
    const response = await $fetch<{
      code: number
      data?: {
        resources?: Record<string, string[]>
      }
    }>(
      `${apiBaseUrl}/api/v1/users/${encodeURIComponent(uid)}/permissions`,
      {
        headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` },
        timeout: 5000
      }
    )

    if (response.code !== 0 || !response.data?.resources) return false

    const key = `${appCode}:${resource}`
    const actions: string[] = response.data.resources[key] || []

    if (action === 'view') {
      return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }
    return actions.includes(action)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[checkPermission] Failed:', message)
    return false
  }
}

/**
 * 要求指定权限，无权限时抛出 403 错误
 */
export async function requirePermission(
  event: H3Event,
  resource: string,
  action: 'view' | 'edit' | 'admin' = 'admin',
  message = '权限不足'
): Promise<void> {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
