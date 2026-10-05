/**
 * 服务端权限检查工具
 */
import { createError, getHeader, type H3Event } from 'h3'
import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import type { PermissionAction } from '~~/app/config/permissions'
import { ensureAltocConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import { altocGlobalAdminExpansion } from '~~/server/utils/globalAdminAuthorization'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'

interface CachedPermissions {
  roles: string[]
  resources: Record<string, string[]>
  actionPolicies: Record<string, { implications: Record<string, string[]> }>
  isSuperAdmin: boolean
}

function isSuperAdminRole(role: string) {
  return role === 'super_admin'
    || role === 'superadmin'
    || role === 'platform:super_admin'
}

function cachePermissions(event: H3Event, permissions: CachedPermissions) {
  ;(event.context as { __altocPermissions?: CachedPermissions }).__altocPermissions = permissions
  return permissions
}

function hasServicePermission(event: H3Event, resource: string, action: PermissionAction) {
  const consoleAuth = event.context.consoleAuth as {
    authenticated?: boolean
    tokenUse?: string
    subjectType?: string
    scopes?: string[]
  } | undefined

  if (!consoleAuth?.authenticated || consoleAuth.tokenUse !== 'service' || consoleAuth.subjectType !== 'service') {
    return false
  }

  const scopes = new Set(consoleAuth.scopes || [])
  if (scopes.has('altoc:*') || scopes.has('altoc:admin') || scopes.has('altoc.admin')) return true
  if (resource && (scopes.has(`altoc:${resource}:${action}`) || scopes.has(`altoc:${resource}:admin`))) return true
  if (resource === 'admin' && scopes.has('altoc:admin:admin')) return true
  if (action === 'view') return scopes.has('altoc:read') || scopes.has('altoc.read')
  if (action === 'edit') return scopes.has('altoc:write') || scopes.has('altoc.write')
  return false
}

async function loadAuthorizationResources(event: H3Event, uid: string): Promise<CachedPermissions> {
  const cached = (event.context as { __altocPermissions?: CachedPermissions }).__altocPermissions
  if (cached) return cached

  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
    localDev: {
      resources: manifestResources
    },
    globalAdminExpansion: altocGlobalAdminExpansion
  })
  if (bundleSnapshot) {
    return cachePermissions(event, {
      roles: bundleSnapshot.roles,
      resources: bundleSnapshot.resources,
      actionPolicies: bundleSnapshot.actionPolicies || {},
      isSuperAdmin: bundleSnapshot.roles.some(isSuperAdminRole)
    })
  }

  return cachePermissions(event, {
    roles: [],
    resources: {},
    actionPolicies: {},
    isSuperAdmin: false
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
  if (process.env.SKIP_PERM_CHECK === '1') return true

  const internalKey = getHeader(event, 'x-internal-api-key')
  if (internalKey && process.env.HZY_INTERNAL_KEY && internalKey === process.env.HZY_INTERNAL_KEY) {
    return true
  }

  await ensureAltocConsoleAuth(event)
  if (hasServicePermission(event, resource, action)) return true

  const uid = getRequestUid(event)
  if (!uid) return false

  // Foundation preserves authorization dependency outages as 503.
  const permissions = await loadAuthorizationResources(event, uid)
  if (permissions.isSuperAdmin) return true

  const actions: string[] = permissions.resources[resource] || []
  return authorizationActionsAllow(actions, action, permissions.actionPolicies[resource])
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
  if (process.env.SKIP_PERM_CHECK === '1') return

  const internalKey = getHeader(event, 'x-internal-api-key')
  if (internalKey && process.env.HZY_INTERNAL_KEY && internalKey === process.env.HZY_INTERNAL_KEY) {
    return
  }

  await ensureAltocConsoleAuth(event)
  if (hasServicePermission(event, resource, action)) return

  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, resource, action)
  if (!allowed) {
    throw createError({
      statusCode: 403,
      message: `${message} (需要 altoc:${resource}:${action})`
    })
  }
}
