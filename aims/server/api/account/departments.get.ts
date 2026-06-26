/**
 * 获取部门列表
 * 路由: GET /api/account/departments
 */

export default defineEventHandler(async (_event) => {
  return await fetchDirectoryApi('/api/v1/directory/departments')
})
