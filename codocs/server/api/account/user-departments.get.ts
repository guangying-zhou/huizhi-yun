/**
 * 获取用户关联的部门列表（含管理/分管的部门及其子部门）
 * 路由: GET /api/account/user-departments?uid=xxx
 *
 * 返回用户的主部门，以及作为负责人或分管领导管理的部门树
 */
import { fetchUserDepartments } from '../../utils/userDepartments'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = query.uid as string

  if (!uid) {
    throw createError({
      statusCode: 400,
      message: 'Missing uid parameter'
    })
  }

  try {
    const { departments, primaryDeptCode } = await fetchUserDepartments(uid)

    return {
      code: 0,
      data: { departments, primaryDeptCode }
    }
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'Failed to fetch user departments'
    console.error('[UserDepartments] Failed:', message)
    throw createError({
      statusCode,
      message
    })
  }
})
