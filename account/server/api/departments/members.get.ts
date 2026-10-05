import { useDbPool } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface MemberRow extends RowDataPacket {
  uid: string
  realName: string | null
  email: string | null
  position: string | null
  dingtalkId: string | null
  isPrimary?: number
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()

  const query = getQuery(event)
  const deptCode = query.deptCode as string

  if (!deptCode) {
    throw createError({
      statusCode: 400,
      message: '缺少 deptCode 参数'
    })
  }

  try {
    const [rows] = await pool.query<MemberRow[]>(
      `SELECT
        ud.uid,
        MAX(su.real_name) AS realName,
        MAX(su.email) AS email,
        MAX(su.position) AS position,
        MAX(su.dingtalk_id) AS dingtalkId
       FROM user_departments ud
       JOIN departments d ON ud.dept_code = d.dept_code
       LEFT JOIN system_users su ON ud.uid = su.uid
       WHERE d.dept_code = ?
       GROUP BY ud.uid
       ORDER BY CONVERT(realName USING gbk) ASC`,
      [deptCode]
    )

    return {
      code: 0,
      data: rows.map(row => ({
        uid: row.uid,
        realName: row.realName,
        email: row.email,
        position: row.position,
        dingtalkId: row.dingtalkId || null,
        isPrimary: Boolean(row.isPrimary)
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get members:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取成员列表失败'
    })
  }
})
