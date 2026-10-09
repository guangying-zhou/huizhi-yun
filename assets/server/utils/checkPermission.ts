/**
 * 服务端权限检查工具
 */
import { createError, type H3Event } from 'h3'
import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import { ensureAssetsConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import { isAssetsLocalDevAuthorizationBypassEnabled } from '~~/server/utils/assetsLocalDevAuthorization'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type PermissionAction = 'view' | 'request' | 'edit' | 'approve' | 'replay' | 'admin'

async function loadAuthorizationSnapshot(event: H3Event, uid: string) {
  return await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
    localDev: {
      enabled: isAssetsLocalDevAuthorizationBypassEnabled(),
      resources: manifestResources,
      fallbackActions: []
    }
  })
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
    const snapshot = await loadAuthorizationSnapshot(event, uid)
    return authorizationResourcesAllow(
      snapshot.resources,
      resource,
      action,
      snapshot.actionPolicies?.[resource]
    )
  } catch {
    throw createError({ statusCode: 503, message: '权限服务暂不可用，请稍后重试' })
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
