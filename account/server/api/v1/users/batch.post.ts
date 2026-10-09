import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['用户信息'],
    summary: '批量获取用户',
    description: '根据 uid 列表批量查询用户信息。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['uids'],
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: '用户名列表' }
            }
          }
        }
      }
    }
  }
})

interface UserRow extends RowDataPacket {
  id: number
  uid: string
  real_name: string | null
  nickname: string | null
  email: string | null
  avatar: string | null
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const pool = useDbPool()
  const body = await readBody(event)

  const { uids } = body

  if (!uids?.length) {
    throw createError({
      statusCode: 400,
      message: 'uids array is required'
    })
  }

  try {
    const sql = `SELECT u.id, u.uid, u.real_name, u.nickname, u.email, u.avatar, u.mobile, u.gender, d.dept_code, d.name as dept_name
           FROM system_users u
           LEFT JOIN user_departments ud ON u.uid = ud.uid
           LEFT JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
           WHERE u.uid IN (${uids.map(() => '?').join(',')})`

    const params = uids

    const [rows] = await pool.query<UserRow[]>(sql, params)

    return {
      code: 0,
      data: rows.map(u => ({
        id: u.id,
        uid: u.uid,
        realName: u.real_name,
        nickname: u.nickname,
        email: u.email,
        mobile: u.mobile,
        avatar: normalizeAvatarOutput(u.avatar),
        gender: u.gender,
        deptCode: u.dept_code,
        deptName: u.dept_name
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to batch get users:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to batch get users'
    })
  }
})
