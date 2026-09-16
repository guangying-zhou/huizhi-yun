import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface SystemUserRow extends RowDataPacket {
  id: number
  email: string
  uid: string | null
  real_name: string | null
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
  const query = getQuery(event)
  const status = query.status

  let sql = `
    SELECT
      su.*,
      primary_dept.primary_dept_code
    FROM system_users su
    LEFT JOIN (
      SELECT
        ud.uid,
        MIN(ud.dept_code) AS primary_dept_code
      FROM user_departments ud
      GROUP BY ud.uid
    ) primary_dept ON su.uid = primary_dept.uid
    WHERE 1=1
  `
  const params: unknown[] = []

  if (status !== undefined) {
    sql += ' AND su.status = ?'
    params.push(String(status))
  }

  sql += ' ORDER BY su.uid ASC'

  // console.log('[API system-users] SQL:', sql, 'Params:', params)
  const users = await queryRows<SystemUserRow[]>(sql, params)

  return {
    data: users.map(user => ({
      id: user.id,
      email: user.email,
      uid: user.uid,
      realName: user.real_name,
      deptCode: user.primary_dept_code, // Use the joined department_code
      mobile: user.mobile,
      status: user.status,
      latestLoggedAt: user.latest_logged_at,
      loginIp: user.login_ip,
      remark: user.remark,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    }))
  }
})
