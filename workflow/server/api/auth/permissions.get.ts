/**
 * 获取当前用户权限。
 *
 * 优先读取本地 Platform policy bundle。
 * 本地 bundle 不存在时返回空权限；业务应用不再直接请求 Platform runtime。
 * GET /api/auth/permissions
 */
import { appCode } from '~~/app/config/permissions'
import { ensureWorkflowConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
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
  await ensureWorkflowConsoleAuth(event)
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event)
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
