/**
 * 取消常用项目
 * DELETE /api/v1/favorites?projectId=123
 */
export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const projectId = Number(query.projectId)
  if (!projectId || isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  await execute(
    'DELETE FROM user_favorite_projects WHERE uid = ? AND project_id = ?',
    [uid, projectId]
  )

  return { code: 0, data: null }
})
