/**
 * 路由: GET /api/account/users/[uid]
 * 说明: Account 兼容路径，实际数据来自 Console Directory。
 */
export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: 'Uid is required' })
  }

  return await fetchDirectoryApi(`/api/v1/directory/users/${encodeURIComponent(uid)}`)
})
