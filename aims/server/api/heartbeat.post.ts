/**
 * 应用心跳
 * POST /api/heartbeat
 *
 * Console OIDC 路径下不再向 legacy Account 上报在线心跳。
 * 当前只验证本地请求身份并返回轻量确认，后续如需在线状态可接入 Console audit/presence。
 */

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    return { success: false }
  }

  const body = await readBody(event)

  return {
    success: true,
    uid,
    sourceApp: body?.sourceApp || 'aims',
    page: body?.page || null,
    status: body?.status || 'active'
  }
})
