import { queryRows, execute } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { logOperationFromEvent } from '~~/server/utils/log'

interface UpdateUserRequest {
  uid?: string
  deptCode?: number | null
  mobile?: string
  status?: number
  remark?: string
}

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'id')

  if (!userId || isNaN(Number(userId))) {
    throw createError({
      statusCode: 400,
      message: '无效的用户ID'
    })
  }

  const body = await readBody<UpdateUserRequest>(event)

  // Build update query dynamically
  const updates: string[] = []
  const params: (string | number | null)[] = []

  interface UserUidRow extends RowDataPacket {
    uid: string | null
    dept_code: string | null
  }

  // We need the uid for user_departments update
  const currentUserRows = await queryRows<UserUidRow[]>(
    'SELECT uid, dept_code FROM system_users WHERE id = ?',
    [Number(userId)]
  )
  if (currentUserRows.length === 0 || !currentUserRows[0]) {
    throw createError({
      statusCode: 404,
      message: '用户不存在'
    })
  }
  const currentUser = currentUserRows[0]
  const targetUid = body.uid !== undefined ? (body.uid || null) : currentUser.uid

  if (body.uid !== undefined) {
    updates.push('uid = ?')
    params.push(body.uid || null)
  }

  // Handle department change in user_departments
  let updateDepartment = false
  if (body.deptCode !== undefined) {
    // We do NOT add to `updates` for system_users.
    // We will run separate queries for user_departments.
    updateDepartment = true
  }

  if (body.mobile !== undefined) {
    updates.push('mobile = ?')
    params.push(body.mobile || null)
  }

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(body.status)
  }

  if (body.remark !== undefined) {
    updates.push('remark = ?')
    params.push(body.remark || null)
  }

  if (updates.length > 0) {
    params.push(Number(userId))
    const sql = `UPDATE system_users SET ${updates.join(', ')} WHERE id = ?`
    await execute(sql, params)
  } else if (!updateDepartment) {
    throw createError({
      statusCode: 400,
      message: '没有提供需要更新的字段'
    })
  }

  // Update user_departments if deptCode changed
  if (updateDepartment && targetUid) {
    // 删除用户在所有非委员会部门的记录（用户只能属于一个部门）
    await execute(
      `DELETE ud FROM user_departments ud
       JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
       WHERE ud.uid = ?`,
      [targetUid]
    )

    if (body.deptCode) {
      await execute(
        'INSERT IGNORE INTO user_departments (uid, dept_code) VALUES (?, ?)',
        [targetUid, body.deptCode]
      )
    }
  }

  await logOperationFromEvent(event, {
    sourceApp: 'account',
    action: 'system_user.update',
    targetType: 'system_user',
    targetId: Number(userId),
    detail: {
      uid: targetUid,
      changes: body
    }
  })

  return {
    success: true,
    message: '更新成功'
  }
})
