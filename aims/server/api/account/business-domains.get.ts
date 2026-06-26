/**
 * 获取业务领域字典
 * 路由: GET /api/account/business-domains
 * Console provider: GET /api/v1/business-domains
 */

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  return await fetchDirectoryApi('/api/v1/business-domains', {
    params: query
  })
})
