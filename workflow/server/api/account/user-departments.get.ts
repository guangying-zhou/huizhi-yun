/**
 * 获取用户关联的部门列表
 *
 * 迁移期保留 /api/account/user-departments 路由名，数据源已切到 Console directory-runtime。
 * 路由: GET /api/account/user-departments?uid=xxx
 */
import { fetchUserDepartments } from '../../utils/userDepartments'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = query.uid as string

  if (!uid) {
    throw createError({ statusCode: 400, message: 'Missing uid parameter' })
  }

  try {
    const { departments, primaryDeptCode } = await fetchUserDepartments(uid)
    return {
      code: 0,
      data: { departments, primaryDeptCode }
    }
  } catch (err) {
    const error = err as { statusCode?: number, message?: string }
    console.error('[UserDepartments] Failed:', error.message || err)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || 'Failed to fetch user departments'
    })
  }
})
