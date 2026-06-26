/**
 * 获取单个用户详情
 *
 * 迁移期保留 /api/account/users/[uid] 路由名，数据源已切到 Console directory-runtime。
 * 路由: GET /api/account/users/[uid]
 */
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: 'Uid is required' })
  }

  return await fetchDirectoryApi(`/api/v1/directory/users/${encodeURIComponent(uid)}`)
})
