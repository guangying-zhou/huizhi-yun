/**
 * 心跳代理
 * POST /api/heartbeat
 */

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    return { success: false }
  }

  const body = await readBody(event)
  return {
    success: true,
    data: {
      uid,
      sourceApp: body?.sourceApp || 'workflow',
      page: body?.page || null,
      status: body?.status || 'active'
    }
  }
})
