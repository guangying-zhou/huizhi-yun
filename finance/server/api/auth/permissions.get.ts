/**
 * 获取当前用户权限
 *
 * 通过 Foundation 调用 Console 运行时授权快照。
 * 业务应用不再读取本地 policy bundle。
 * GET /api/auth/permissions
 */
import type { H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'
import { ensureFinanceConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
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
  await ensureFinanceConsoleAuth(event)
  const uid = getRequestUid(event)

  if (isDevPermissionBypassEnabled(event)) {
    const roleCode = 'finance:admin'
    return {
      code: 0,
      data: {
        uid: uid || 'finance-dev',
        roles: [roleCode],
        availableRoles: [{
          roleCode,
          roleName: 'Finance Dev Admin',
          roleType: 'dev',
          appCode,
          sources: ['dev']
        }],
        activeRoleCode: roleCode,
        resources: {
          dashboard: ['view', 'edit', 'admin'],
          invoices: ['view', 'edit', 'approve', 'admin'],
          receipts: ['view', 'edit', 'confirm', 'admin'],
          expenses: ['view', 'edit', 'approve', 'confirm', 'admin'],
          bank_accounts: ['view', 'edit', 'admin'],
          reconciliation: ['view', 'edit', 'confirm', 'admin'],
          project_accounting: ['view', 'edit', 'admin'],
          performance: ['view', 'edit', 'admin'],
          reports: ['view', 'export', 'admin'],
          settings: ['view', 'edit', 'admin']
        }
      }
    }
  }

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

function isDevPermissionBypassEnabled(event: H3Event) {
  const config = useRuntimeConfig(event) as {
    hzy?: {
      financeDevPermissions?: boolean
    }
  }
  return config.hzy?.financeDevPermissions === true
    || String(process.env.HZY_FINANCE_DEV_PERMISSIONS || '').toLowerCase() === 'true'
}
