/**
 * 路由: POST /api/account/users/batch
 * 说明: Account 兼容路径，实际数据来自 Console Directory。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.uids || !Array.isArray(body.uids)) {
    throw createError({
      statusCode: 400,
      message: 'uids array is required'
    })
  }

  return await fetchDirectoryApi('/api/v1/directory/users/batch', {
    method: 'POST',
    body: { uids: body.uids }
  })
})
