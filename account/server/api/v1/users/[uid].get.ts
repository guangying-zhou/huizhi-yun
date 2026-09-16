import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['用户信息'],
    summary: '获取用户详情',
    description: '根据 uid 获取单个用户详细信息，含所属部门。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'uid', required: true, schema: { type: 'string' }, description: '用户名（uid）' }
    ]
  }
})

interface UserRow extends RowDataPacket {
  id: number
  uid: string
  real_name: string | null
  nickname: string | null
  email: string | null
  avatar: string | null
  mobile: string | null
  gender: number | null
  dept_code: string | null
  status: number
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to get user'
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const pool = useDbPool()
  const uid = getRouterParam(event, 'uid')

  if (!uid) {
    throw createError({
      statusCode: 400,
      message: 'Uid is required'
    })
  }

  try {
    // Get user info with department (用户唯一的非委员会部门即为主部门)
    const [users] = await pool.query<UserRow[]>(
      `SELECT
        u.id, u.uid, u.real_name, u.nickname, u.email, u.avatar, u.mobile, u.gender, u.status,
        d.dept_code, d.name as dept_name
      FROM system_users u
      LEFT JOIN user_departments ud ON u.uid = ud.uid
      LEFT JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
      WHERE u.uid = ? AND u.user_type = 1 AND u.status = 1
      LIMIT 1`,
      [uid]
    )

    if (users.length === 0) {
      throw createError({
        statusCode: 404,
        message: 'User not found'
      })
    }

    const user = users[0]
    if (!user) {
      throw createError({
        statusCode: 404,
        message: 'User not found'
      })
    }

    return {
      code: 0,
      data: {
        id: user.id,
        uid: user.uid,
        realName: user.real_name,
        nickname: user.nickname,
        email: user.email,
        mobile: user.mobile,
        avatar: normalizeAvatarOutput(user.avatar),
        gender: user.gender,
        deptCode: user.dept_code,
        deptName: user.dept_name
      }
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) throw error
    console.error('Failed to get user:', error)
    throw createError({
      statusCode: 500,
      message: getErrorMessage(error)
    })
  }
})
