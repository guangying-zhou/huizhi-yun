/**
 * 路由: GET /api/account/users/[uid]/projects
 * 说明: Account 兼容路径，实际数据来自 Console Directory。
 */
export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: 'Uid is required' })
  }

  const actorUid = await requireCurrentAltocSessionUid(event, uid, '无权查看其他用户的项目关系')

  return await fetchDirectoryApi(`/api/v1/directory/users/${encodeURIComponent(actorUid)}/projects`, {
    params: getQuery(event)
  })
})
