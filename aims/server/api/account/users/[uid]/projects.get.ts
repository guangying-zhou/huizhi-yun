/**
 * 获取用户的项目
 * 路由: GET /api/account/users/[uid]/git-projects
 */

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: 'Uid is required' })
  }

  const actorUid = await requireCurrentAimsSessionUid(event, uid, '无权查看其他用户的项目关系')

  return await fetchDirectoryApi(`/api/v1/directory/users/${encodeURIComponent(actorUid)}/projects`, {
    params: getQuery(event)
  })
})
