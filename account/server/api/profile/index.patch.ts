import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const body = await readBody(event)

  // Get current user from cookies - support both auth_email and auth_user
  const authEmail = getCookie(event, 'auth_email')
  const authUser = getCookie(event, 'auth_user')

  if (!authEmail && !authUser) {
    throw createError({
      statusCode: 401,
      message: '请先登录'
    })
  }

  const { nickname, mobile, position } = body

  try {
    // Get uid - either directly from auth_user or lookup by email
    let ldapUid: string

    if (authUser) {
      ldapUid = authUser
    } else {
      const [users] = await pool.query(
        'SELECT uid FROM user_status_cache WHERE email = ?',
        [authEmail]
      ) as [RowDataPacket[], unknown]

      if (users.length === 0 || !users[0]) {
        throw createError({
          statusCode: 404,
          message: '用户不存在'
        })
      }
      ldapUid = users[0].uid
    }

    // Check if system_users exists
    const [profiles] = await pool.query(
      'SELECT id FROM system_users WHERE uid = ?',
      [ldapUid]
    ) as [RowDataPacket[], unknown]

    if (profiles.length === 0) {
      // Create profile if not exists
      await pool.query(
        'INSERT INTO system_users (uid, nickname, mobile, position) VALUES (?, ?, ?, ?)',
        [ldapUid, nickname || null, mobile || null, position || null]
      )
    } else {
      // Update existing profile
      const updates: string[] = []
      const params: unknown[] = []

      if (nickname !== undefined) {
        updates.push('nickname = ?')
        params.push(nickname || null)
      }
      if (mobile !== undefined) {
        updates.push('mobile = ?')
        params.push(mobile || null)
      }
      if (position !== undefined) {
        updates.push('position = ?')
        params.push(position || null)
      }

      if (updates.length > 0) {
        params.push(ldapUid)
        await pool.query(
          `UPDATE system_users SET ${updates.join(', ')} WHERE uid = ?`,
          params
        )
      }
    }

    return {
      code: 0,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新用户信息失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新用户信息失败'
    })
  }
})
