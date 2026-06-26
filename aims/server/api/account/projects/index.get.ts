/**
 * 获取项目列表
 * 路由: GET /api/account/git-projects
 */

export default defineEventHandler(async (event) => {
  return await fetchDirectoryApi('/api/v1/directory/projects', {
    params: getQuery(event)
  })
})
