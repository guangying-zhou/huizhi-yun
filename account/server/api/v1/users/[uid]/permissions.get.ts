/**
 * 获取用户权限
 * GET /api/v1/users/:uid/permissions
 *
 * 返回用户通过角色获得的所有资源权限（resource+action 格式）
 * 供应用端菜单过滤、路由守卫、操作控制使用
 */
import { verifyApiKey } from '~~/server/utils/api-auth'
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['用户信息'],
    summary: '获取用户权限',
    description: '获取用户通过角色获得的所有资源权限（RBAC 模型），供菜单过滤、路由守卫使用。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'uid', required: true, schema: { type: 'string' }, description: '用户名（uid）' }
    ]
  }
})

interface RoleRow extends RowDataPacket {
  role_code: string
  role_name: string
}

interface PermRow extends RowDataPacket {
  app_code: string
  resource_code: string
  action: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }

  try {
    // Get user's roles
    const roles = await queryRows<RoleRow[]>(
      `SELECT r.role_code, r.role_name
       FROM roles r
       INNER JOIN user_roles ur ON r.id = ur.role_id
       LEFT JOIN system_users u ON ur.uid = u.uid
       WHERE (ur.uid = ? OR u.dingtalk_id = ? OR u.email = ?) AND r.status = 1`,
      [uid, uid, uid]
    )

    // Get user's permissions through roles (new resource+action model)
    const permissions = await queryRows<PermRow[]>(
      `SELECT DISTINCT a.app_code, res.resource_code, rp.action
       FROM role_permissions rp
       INNER JOIN resources res ON rp.resource_id = res.id
       INNER JOIN applications a ON res.app_id = a.id
       INNER JOIN user_roles ur ON rp.role_id = ur.role_id
       LEFT JOIN system_users u ON ur.uid = u.uid
       WHERE (ur.uid = ? OR u.dingtalk_id = ? OR u.email = ?) AND res.status = 1`,
      [uid, uid, uid]
    )

    // Group by app_code:resource_code -> actions[]
    const resourcePermissions: Record<string, string[]> = {}
    for (const p of permissions) {
      const key = `${p.app_code}:${p.resource_code}`
      if (!resourcePermissions[key]) {
        resourcePermissions[key] = []
      }
      resourcePermissions[key]!.push(p.action)
    }

    console.log(`[Permissions API] Requested uid: ${uid}`)
    console.log('[Permissions API] Found roles:', roles.map(r => r.role_code))
    console.log('[Permissions API] Found resource combinations:', Object.keys(resourcePermissions))

    return {
      code: 0,
      data: {
        uid,
        roles: roles.map(r => ({
          code: r.role_code,
          name: r.role_name
        })),
        resources: resourcePermissions
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get user permissions:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get user permissions'
    })
  }
})
