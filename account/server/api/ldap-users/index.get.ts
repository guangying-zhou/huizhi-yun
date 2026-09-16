import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

interface LdapUserRow extends RowDataPacket {
  id: number
  uid: string
  mobile: string | null
  real_name: string | null
  email: string | null
  nickname: string | null
  avatar: string | null
  gender: number | null
  wecom_id: string | null
  dingtalk_id: string | null
  status: number
  created_at: string
  updated_at: string
  departments?: unknown[]
}

interface DeptRow extends RowDataPacket {
  uid: string
  id: number
  name: string
  org_type: string | null
}

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const pageSize = Number(query.page_size) || 100
  const search = query.search as string | undefined
  const status = query.status as string | undefined ?? '1'

  try {
    // 联合查询 user_status_cache 和 system_users
    let sql = `
      SELECT
        up.id,
        up.uid,
        up.mobile,
        up.real_name,
        up.email,
        up.nickname,
        up.avatar,
        up.gender,
        up.wecom_id,
        up.dingtalk_id,
        up.status,
        up.created_at,
        up.updated_at
      FROM system_users up
      WHERE 1=1
    `

    const params: unknown[] = []

    if (search) {
      sql += ' AND (up.uid LIKE ? OR up.mobile LIKE ? OR up.email LIKE ? OR up.real_name LIKE ? OR up.nickname LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
    }

    if (status !== 'all') {
      sql += ' AND up.status = ?'
      params.push(Number(status))
    }

    sql += ` ORDER BY up.uid ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`

    const [rows] = await pool.query<LdapUserRow[]>(sql, params)

    const uids = rows.map(r => r.uid).filter(Boolean)
    if (uids.length > 0) {
      const [deptRows] = await pool.query<DeptRow[]>(
        `SELECT ud.uid, d.id, d.name, d.org_type
         FROM user_departments ud
         JOIN departments d ON ud.dept_code = d.dept_code
         WHERE ud.uid IN (${uids.map(() => '?').join(',')})
         ORDER BY d.org_type ASC`,
        uids
      )

      const deptMap = new Map<string, unknown[]>()
      for (const dr of deptRows) {
        if (!deptMap.has(dr.uid)) deptMap.set(dr.uid, [])
        deptMap.get(dr.uid)!.push({
          id: dr.id,
          name: dr.name,
          org_type: dr.org_type || 'department'
        })
      }

      for (const row of rows) {
        row.departments = deptMap.get(row.uid) || []
      }
    }

    // 获取总数
    let countSql = `
      SELECT COUNT(*) as total
      FROM system_users up
      WHERE 1=1
    `
    const countParams: unknown[] = []
    if (search) {
      countSql += ' AND (up.uid LIKE ? OR up.mobile LIKE ? OR up.email LIKE ? OR up.real_name LIKE ? OR up.nickname LIKE ?)'
      const searchPattern = `%${search}%`
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
    }
    if (status !== 'all') {
      countSql += ' AND up.status = ?'
      countParams.push(Number(status))
    }
    const [countRows] = await pool.query<RowDataPacket[]>(countSql, countParams)
    const total = countRows[0]?.total || 0

    return {
      success: true,
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  } catch (error) {
    console.error('Error fetching users:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : '获取用户列表失败'
    })
  }
})
