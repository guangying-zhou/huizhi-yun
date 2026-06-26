/**
 * 获取当前用户权限
 *
 * 优先从 Console runtime 获取当前授权，失败后回退本地 Platform policy bundle。
 * GET /api/auth/permissions
 */
import { appCode, manifestResources } from '~~/app/config/permissions'
import {
  loadAuthorizationSnapshotFromConsoleRuntime,
  type RuntimeAuthorizationRole
} from '@hzy/foundation/server/utils/platformBundleAuthorization'

interface PermissionsResponse {
  code: number
  data: {
    uid: string
    roles: string[]
    availableRoles: RuntimeAuthorizationRole[]
    activeRoleCode: string
    resources: Record<string, unknown>
  }
}

export default defineEventHandler(async (event): Promise<PermissionsResponse> => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
    globalAdminExpansion: {
      resources: manifestResources,
      roleCode: 'aims:admin'
    }
  })
  if (bundleSnapshot) {
    return {
      code: 0,
      data: {
        uid: bundleSnapshot.uid,
        roles: bundleSnapshot.roles,
        availableRoles: bundleSnapshot.availableRoles,
        activeRoleCode: bundleSnapshot.activeRoleCode,
        resources: bundleSnapshot.resources
      }
    }
  }

  return {
    code: 0,
    data: { uid, roles: [], availableRoles: [], activeRoleCode: '', resources: {} }
  }
})
