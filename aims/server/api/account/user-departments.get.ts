/**
 * 获取用户关联的部门列表
 * 路由: GET /api/account/user-departments?uid=xxx
 */
import { fetchUserDepartments } from '../../utils/userDepartments'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = query.uid as string

  if (!uid) {
    throw createError({ statusCode: 400, message: 'Missing uid parameter' })
  }

  const actorUid = await requireCurrentAimsSessionUid(event, uid)

  try {
    const { departments, primaryDeptCode } = await fetchUserDepartments(event, actorUid)
    return {
      code: 0,
      data: { departments, primaryDeptCode }
    }
  } catch (error: unknown) {
    const err = error as { message?: string, statusCode?: number }
    console.error('[UserDepartments] Failed:', err.message || error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to fetch user departments'
    })
  }
})
