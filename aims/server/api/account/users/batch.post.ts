/**
 * 批量获取用户
 * 路由: POST /api/account/users/batch
 */

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
