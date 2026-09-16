import { useDbPool } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const query = getQuery(event)
  const projectCode = query.projectCode as string

  if (!projectCode) {
    throw createError({ statusCode: 400, message: '缺少 projectCode 参数' })
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pm.uid, pm.role, su.real_name AS realName, su.email
             FROM git_project_members pm
             LEFT JOIN system_users su ON pm.uid = su.uid
             WHERE pm.project_code = ?
             ORDER BY pm.role DESC, CONVERT(su.real_name USING gbk) ASC`,
      [projectCode]
    )

    return { code: 0, data: rows }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('Failed to get project members:', error)
    throw createError({ statusCode: 500, message: '获取项目成员失败' })
  }
})
