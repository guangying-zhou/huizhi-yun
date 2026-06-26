/**
 * 获取用户列表
 * 路由: GET /api/account/users
 * Console provider: GET /api/v1/directory/users
 */
export default defineEventHandler(async (event) => {
  return await fetchDirectoryApi('/api/v1/directory/users', {
    params: getQuery(event)
  })
})
