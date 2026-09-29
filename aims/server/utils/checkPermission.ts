/**
 * 服务端权限检查工具
 */
import type { H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'
import {
  loadAuthorizationSnapshotFromConsoleRuntime
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type PermissionAction
  = 'view'
    | 'create'
    | 'edit'
    | 'delete'
    | 'assign'
    | 'submit'
    | 'approve'
    | 'review'
    | 'publish'
    | 'waive'
    | 'configure'
    | 'confirm'
    | 'close'
    | 'export'
    | 'replay'
    | 'admin'

async function loadAuthorizationSnapshot(uid: string, event: H3Event) {
  return await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event)
}

// Only an authentication refusal of the snapshot request means "not allowed".
// Any other failure is a Console authorization outage and must stay 503; it is
// never disguised as the user lacking a permission (403).
function authorizationFailure(scope: string, error: unknown): false {
  const failure = error as { statusCode?: unknown, status?: unknown, message?: string }
  const status = Number(failure?.statusCode ?? failure?.status)
  if (status === 401 || status === 403) return false
  console.error(`[${scope}] Authorization snapshot unavailable:`, failure?.message)
  throw createError({ statusCode: 503, message: '授权服务暂不可用' })
}

export async function checkRole(event: H3Event, roleCode: string): Promise<boolean> {
  const uid = getRequestUid(event)
  if (!uid) return false

  try {
    const snapshot = await loadAuthorizationSnapshot(uid, event)
    return Boolean(snapshot?.roles.includes(roleCode))
  } catch (error: unknown) {
    return authorizationFailure('checkRole', error)
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
    const snapshot = await loadAuthorizationSnapshot(uid, event)
    return authorizationResourcesAllow(
      snapshot.resources,
      resource,
      action,
      snapshot.actionPolicies?.[resource]
    )
  } catch (error: unknown) {
    return authorizationFailure('checkPermission', error)
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
