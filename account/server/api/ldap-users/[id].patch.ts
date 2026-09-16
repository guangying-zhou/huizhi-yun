import { useDbPool } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少用户 ID'
    })
  }

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

    // 先获取要更新的用户的 UID
    const [userRows] = await pool.query<RowDataPacket[]>('SELECT uid FROM system_users WHERE id = ?', [id])
    if (userRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '用户不存在'
      })
    }
    const targetUid = userRows[0]!.uid

    // 更新 system_users 表的字段
    const allowedFields = ['real_name', 'nickname', 'avatar', 'gender', 'status', 'email', 'user_type', 'dingtalk_id']
    const updates: string[] = []
    const params: unknown[] = []

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`)
        // Handle null properly - if value is null or empty string for nullable fields, use null
        let value = body[field]
        if (value === '' || value === 'undefined' || value === 'null') {
          value = null
        }
        params.push(value)
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(now)
      params.push(id)

      const sql = `UPDATE system_users SET ${updates.join(', ')} WHERE id = ?`
      await pool.query(sql, params)
    }

    // 更新 user_departments (如果传了 dept_code)
    if (body.dept_code !== undefined && targetUid) {
      let newDeptCode = body.dept_code
      if (newDeptCode === '' || newDeptCode === 'undefined' || newDeptCode === 'null') {
        newDeptCode = null
      }

      // 删除用户在所有非委员会部门的记录
      await pool.query(
        `DELETE ud FROM user_departments ud
         JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
         WHERE ud.uid = ?`,
        [targetUid]
      )

      if (newDeptCode) {
        await pool.query('INSERT IGNORE INTO user_departments (uid, dept_code) VALUES (?, ?)', [targetUid, newDeptCode])
      }
    }

    if (updates.length === 0 && body.dept_code === undefined) {
      throw createError({
        statusCode: 400,
        message: '没有需要更新的字段'
      })
    }

    return {
      success: true,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Error updating user:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新用户失败'
    })
  }
})
