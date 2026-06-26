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
  const uid = getCookie(event, 'hzy_uid') || getCookie(event, 'auth_user')
  if (!uid) return false

  return resource === 'dashboard' && action === 'view'
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
  const uid = getCookie(event, 'hzy_uid') || getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
