/**
 * 删除用户 (软删)
 * DELETE /api/ldap-users/:id
 */
import { execute, queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  // 检查权限 - 需要是 admin，或者至少要验证 session
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  // 我们可以验证当前用户是否是 admin，通过查 role_bindings 等
  // 但在原有的修改逻辑里似乎没有强网关，我们先执行最基本的权限校验
  // 在后端校验用户是否有 account:admin 资源的操作权限
  const perms = await queryRows<RowDataPacket[]>(
    `SELECT 1
         FROM role_permissions rp
         INNER JOIN resources res ON res.id = rp.resource_id
         INNER JOIN applications a ON a.id = res.app_id
         INNER JOIN user_roles ur ON ur.role_id = rp.role_id
         WHERE ur.uid = ? AND a.app_code = 'account' AND res.resource_code = 'admin' AND rp.action IN ('edit', 'admin')
         LIMIT 1`,
    [uid]
  )
  if (perms.length === 0) {
    throw createError({ statusCode: 403, message: 'Forbidden: Requires admin resource permission' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing user ID' })
  }

  // 查询被删用户
  const targetUserRows = await queryRows<RowDataPacket[]>('SELECT uid FROM system_users WHERE id = ?', [id])
  if (targetUserRows.length === 0) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }
  const targetUser = targetUserRows[0]

  // 软删除用户 (将 status 设为 -1)
  await execute('UPDATE system_users SET status = -1 WHERE id = ?', [id])

  // 从 user_departments 表中移除
  if (targetUser && targetUser.uid) {
    await execute('DELETE FROM user_departments WHERE uid = ?', [targetUser.uid])
  }

  return { success: true }
})
