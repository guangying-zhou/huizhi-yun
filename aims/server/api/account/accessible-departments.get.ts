/**
 * 获取当前用户有权限的部门列表
 * GET /api/account/accessible-departments
 *
 * 兼容旧前端路径，数据源固定为 Console Directory Runtime。
 */

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  return {
    code: 0,
    data: await fetchAccessibleDepartments(uid)
  }
})
