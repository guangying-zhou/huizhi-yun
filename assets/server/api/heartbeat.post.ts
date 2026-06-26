/**
 * 心跳兼容接口。
 *
 * Console OIDC 运行时不再向 Account 上报心跳；保留成功响应避免前端轮询噪音。
 */
import { getRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    return { success: false }
  }

  const body = await readBody(event).catch(() => ({}))
  return {
    success: true,
    data: {
      uid,
      sourceApp: body?.sourceApp || 'assets',
      page: body?.page || null,
      status: body?.status || 'active'
    }
  }
})
