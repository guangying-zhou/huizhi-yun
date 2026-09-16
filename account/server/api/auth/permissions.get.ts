/**
 * 获取当前用户权限（Account 直接查询自身数据库）
 * GET /api/auth/permissions
 */
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  try {
    // 查询用户角色
    const roles = await queryRows<(RowDataPacket & { code: string, name: string })[]>(
      `SELECT r.role_code as code, r.role_name as name
       FROM roles r
       INNER JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.uid = ?`,
      [uid]
    )

    // 查询用户资源权限
    const perms = await queryRows<(RowDataPacket & {
      app_code: string
      resource_code: string
      action: string
    })[]>(
      `SELECT a.app_code, res.resource_code, rp.action
       FROM role_permissions rp
       INNER JOIN resources res ON res.id = rp.resource_id
       INNER JOIN applications a ON a.id = res.app_id
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.uid = ? AND res.status = 1`,
      [uid]
    )

    // 按 "appCode:resourceCode" 分组
    const resourceMap: Record<string, string[]> = {}
    for (const p of perms) {
      const key = `${p.app_code}:${p.resource_code}`
      if (!resourceMap[key]) {
        resourceMap[key] = []
      }
      if (!resourceMap[key].includes(p.action)) {
        resourceMap[key].push(p.action)
      }
    }

    return {
      code: 0,
      data: {
        uid,
        roles,
        resources: resourceMap
      }
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[Auth Permissions] Failed to query:', error.message)
    return {
      code: 0,
      data: {
        uid,
        roles: [],
        resources: {}
      }
    }
  }
})
