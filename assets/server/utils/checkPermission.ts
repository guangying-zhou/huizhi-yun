/**
 * 服务端权限检查工具
 */
import type { H3Event } from 'h3'
import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import { ensureAssetsConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'

type AuthorizationResources = Record<string, string[]>
type PermissionAction = 'view' | 'edit' | 'approve' | 'admin'

async function loadAuthorizationResources(event: H3Event, uid: string): Promise<AuthorizationResources> {
  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
    localDev: {
      resources: manifestResources,
      fallbackActions: ['view', 'edit', 'admin']
    }
  })
  if (bundleSnapshot) {
    return bundleSnapshot.resources
  }

  return {}
}

/**
 * 检查当前请求用户是否拥有指定权限
 */
export async function checkPermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin'
): Promise<boolean> {
  await ensureAssetsConsoleAuth(event)
  const uid = getRequestUid(event)
  if (!uid) return false

  try {
    const resources = await loadAuthorizationResources(event, uid)
    const actions: string[] = resources[resource] || []

    if (action === 'view') {
      return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }
    return actions.includes(action)
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[checkPermission] Failed:', err.message)
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
  await ensureAssetsConsoleAuth(event)
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
