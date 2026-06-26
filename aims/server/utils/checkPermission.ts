/**
 * 服务端权限检查工具
 */
import type { H3Event } from 'h3'
import { appCode, manifestResources } from '~~/app/config/permissions'
import {
  loadAuthorizationSnapshotFromConsoleRuntime
} from '@hzy/foundation/server/utils/platformBundleAuthorization'

type AuthorizationResources = Record<string, string[]>
type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'assign' | 'submit' | 'approve' | 'confirm' | 'close' | 'export' | 'admin'

async function loadAuthorizationSnapshot(uid: string, event: H3Event) {
  return await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
    globalAdminExpansion: {
      resources: manifestResources,
      roleCode: 'aims:admin'
    }
  })
}

async function loadAuthorizationResources(uid: string, event: H3Event): Promise<AuthorizationResources> {
  const bundleSnapshot = await loadAuthorizationSnapshot(uid, event)
  if (bundleSnapshot) {
    return bundleSnapshot.resources
  }

  return {}
}

export async function checkRole(event: H3Event, roleCode: string): Promise<boolean> {
  const uid = getRequestUid(event)
  if (!uid) return false

  try {
    const snapshot = await loadAuthorizationSnapshot(uid, event)
    return Boolean(snapshot?.roles.includes(roleCode))
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[checkRole] Failed:', err.message)
    return false
  }
}

export async function requireRole(
  event: H3Event,
  roleCode: string,
  message = '权限不足'
): Promise<void> {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkRole(event, roleCode)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}

/**
 * 检查当前请求用户是否拥有指定权限
 */
export async function checkPermission(
  event: H3Event,
  resource: string,
  action: PermissionAction = 'admin'
): Promise<boolean> {
  const uid = getRequestUid(event)
  if (!uid) return false

  try {
    const resources = await loadAuthorizationResources(uid, event)
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
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
