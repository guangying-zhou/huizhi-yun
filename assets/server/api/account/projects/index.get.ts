/**
 * 路由: GET /api/account/projects
 * 说明: Account 兼容路径，实际数据来自 Console Directory。
 */
export default defineEventHandler(async (event) => {
  return await fetchDirectoryApi('/api/v1/directory/projects', {
    params: getQuery(event)
  })
})
