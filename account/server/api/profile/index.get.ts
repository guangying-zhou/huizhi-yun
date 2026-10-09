import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()

  // Get current user from cookies - support both auth_email and auth_user
  const authEmail = getCookie(event, 'auth_email')
  const authUser = getCookie(event, 'auth_user')

  console.log('[Profile API] Auth cookies:', { authEmail, authUser })

  if (!authEmail && !authUser) {
    throw createError({
      statusCode: 401,
      message: '请先登录'
    })
  }

  try {
    // Build query based on available auth info
    let whereClause = ''
    let params: unknown[] = []

    if (authEmail) {
      whereClause = 'usc.email = ?'
      params = [authEmail]
    } else if (authUser) {
      whereClause = 'usc.ldap_uid = ?'
      params = [authUser]
    }

    console.log('[Profile API] Query:', whereClause, params)

    // Get user from user_status_cache
    const [users] = await pool.query(
      `SELECT usc.id, usc.ldap_uid AS uid, usc.email, usc.status, usc.synced_at,
              up.real_name, up.nickname, up.avatar, up.mobile, up.position,
              ud.dept_code AS primary_dept_code
       FROM user_status_cache usc
       LEFT JOIN system_users up ON usc.ldap_uid = up.uid
       LEFT JOIN user_departments ud ON up.uid = ud.uid
       LEFT JOIN departments d_dept ON ud.dept_code = d_dept.dept_code AND d_dept.org_type = 'department'
       WHERE ${whereClause}`,
      params
    ) as [RowDataPacket[], unknown]

    console.log('[Profile API] Found users:', users.length)

    if (users.length === 0 || !users[0]) {
      // User not in cache - return basic info from auth cookies
      return {
        code: 0,
        message: 'success',
        data: {
          id: 0,
          uid: authUser || '',
          email: authEmail || '',
          real_name: null,
          nickname: null,
          avatar: null,
          mobile: null,
          position: null,
          status: 1,
          synced_at: null,
          department: null,
          roles: []
        }
      }
    }

    const user = users[0]

    // Get user roles
    const [roles] = await pool.query(
      `SELECT r.id, r.role_code, r.role_name
       FROM roles r
       INNER JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.uid = ?`,
      [user.uid]
    ) as [RowDataPacket[], unknown]

    // Get department info if exists
    let department = null
    if (user.primary_dept_code) {
      const [depts] = await pool.query(
        'SELECT id, name, dept_code FROM departments WHERE dept_code = ?',
        [user.primary_dept_code]
      ) as [RowDataPacket[], unknown]
      if (depts.length > 0) {
        department = depts[0]
      }
    }

    return {
      code: 0,
      message: 'success',
      data: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        real_name: user.real_name,
        nickname: user.nickname,
        avatar: normalizeAvatarOutput(user.avatar),
        mobile: user.mobile,
        position: user.position,
        status: user.status,
        synced_at: user.synced_at,
        department,
        roles
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('获取用户信息失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取用户信息失败'
    })
  }
})
