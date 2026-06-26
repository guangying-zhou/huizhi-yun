/**
 * 批量获取用户
 *
 * 迁移期保留 /api/account/users/batch 路由名，数据源已切到 Console directory-runtime。
 * 路由: POST /api/account/users/batch
 */
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.uids || !Array.isArray(body.uids)) {
    throw createError({ statusCode: 400, message: 'uids array is required' })
  }

  return await fetchDirectoryApi('/api/v1/directory/users/batch', {
    method: 'POST',
    body: { uids: body.uids }
  })
})
