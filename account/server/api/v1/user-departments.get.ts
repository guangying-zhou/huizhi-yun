import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['部门信息'],
    summary: '获取用户-部门关联列表',
    description: '返回所有 user_departments 记录（包含委员会成员关系）。需要 API Key 认证。'
  }
})

interface Row extends RowDataPacket {
  uid: string
  dept_code: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const pool = useDbPool()

  try {
    const [rows] = await pool.query<Row[]>(
      `SELECT ud.uid, ud.dept_code
       FROM user_departments ud
       INNER JOIN system_users u ON ud.uid = u.uid
       INNER JOIN departments d ON ud.dept_code = d.dept_code
       WHERE u.user_type = 1 AND u.status = 1 AND d.status = 1`
    )

    return {
      code: 0,
      data: rows.map(r => ({ uid: r.uid, deptCode: r.dept_code }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get user-departments:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get user-departments'
    })
  }
})
