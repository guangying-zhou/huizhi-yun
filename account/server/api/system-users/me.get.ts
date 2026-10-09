import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { defineEventHandler, getCookie, createError } from 'h3'

interface SystemUserRow extends RowDataPacket {
  id: number
  email: string
  uid: string | null
  dept_code: string | null
  mobile: string | null
  status: number
  latest_logged_at: string | null
  login_ip: string | null
  remark: string | null
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  // Get email from auth cookie
  const email = getCookie(event, 'auth_email')

  if (!email) {
    throw createError({
      statusCode: 401,
      message: '未登录或登录已过期'
    })
  }

  const sql = `
    SELECT
      su.*,
      ud.dept_code AS primary_dept_code
    FROM system_users su
    LEFT JOIN user_departments ud ON su.uid = ud.uid
    LEFT JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
    WHERE su.email = ?
  `

  const users = await queryRows<SystemUserRow[]>(sql, [email])

  if (users.length === 0 || !users[0]) {
    throw createError({
      statusCode: 404,
      message: '用户不存在'
    })
  }

  const user = users[0]

  return {
    id: user.id,
    email: user.email,
    uid: user.uid,
    deptCode: user.primary_dept_code,
    mobile: user.mobile,
    status: user.status,
    latestLoggedAt: user.latest_logged_at,
    loginIp: user.login_ip,
    remark: user.remark,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  }
})
