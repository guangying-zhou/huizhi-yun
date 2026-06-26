import { createError, type H3Event } from 'h3'
import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import { getRequestUid } from '~~/server/utils/authIdentity'
import {
  loadAuthorizationSnapshotFromConsoleRuntime
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import type { PermissionAction } from '~/types/account'

type AuthorizationResources = Record<string, string[]>

/**
 * 检查当前请求用户是否拥有指定权限
 * @param event H3 事件对象
 * @param resource 资源编码（如 'company', 'departments'）
 * @param action 操作类型（'view' | 'edit' | 'admin'）
 * @returns true 表示有权限
 */
export async function checkPermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin'
): Promise<boolean> {
  const uid = getRequestUid(event)
  if (!uid) return false

  try {
    const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
      localDev: {
        resources: manifestResources,
        fallbackActions: ['view', 'edit', 'admin']
      }
    })
    const resources: AuthorizationResources = bundleSnapshot?.resources || {}
    const actions = resources[resource] || []

    if (action === 'view') {
      return (
        actions.includes('view')
        || actions.includes('edit')
        || actions.includes('admin')
      )
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }
    return actions.includes(action)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[codocs.checkPermission] Failed:', message)
    return false
  }
}

/**
 * 要求指定权限，无权限时抛出 403 错误
 */
export async function requirePermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin',
  message = '权限不足'
): Promise<void> {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
