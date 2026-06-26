/**
 * 取消关联 GitLab 提交
 * DELETE /api/v1/work-items/:id/commits/:commitId
 */
export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  const commitId = Number(getRouterParam(event, 'commitId'))
  if (!workItemId || !commitId) {
    throw createError({ statusCode: 400, message: '参数无效' })
  }

  await execute(
    'UPDATE gitlab_commits SET work_item_id = NULL WHERE id = ? AND work_item_id = ?',
    [commitId, workItemId]
  )

  return { code: 0, data: null }
})
