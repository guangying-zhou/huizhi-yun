/**
 * 获取当前用户权限
 *
 * 通过 Foundation 调用 Console 运行时授权快照。
 * 业务应用不再读取本地 policy bundle。
 * GET /api/auth/permissions
 */
import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import { getRequestUid } from '~~/server/utils/authIdentity'
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
    localDev: {
      resources: manifestResources,
      fallbackActions: ['view', 'edit', 'admin']
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
