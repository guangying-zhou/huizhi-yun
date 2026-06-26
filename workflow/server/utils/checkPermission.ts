/**
 * 服务端权限检查工具
 */
import type { H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'
import { ensureWorkflowConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import {
  loadAuthorizationSnapshotFromConsoleRuntime
} from '@hzy/foundation/server/utils/platformBundleAuthorization'

type AuthorizationResources = Record<string, string[]>

async function loadAuthorizationResources(uid: string, event: H3Event): Promise<AuthorizationResources> {
  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event)
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
  action: string = 'admin'
): Promise<boolean> {
  await ensureWorkflowConsoleAuth(event)
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
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
  action: string = 'admin',
  message = '权限不足'
): Promise<void> {
  await ensureWorkflowConsoleAuth(event)
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({ statusCode: 403, message })
  }
}
