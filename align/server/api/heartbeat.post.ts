/**
 * 心跳代理
 * POST /api/heartbeat
 *
 * 转发到 Account 模块的心跳 API。
 */

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    return { success: false }
  }

  const body = await readBody(event)
  const config = useRuntimeConfig()
  const apiBaseUrl = config.hzy?.apiBaseUrl as string
  const apiKey = config.hzy?.apiKey as string
  const apiSecret = config.hzy?.apiSecret as string

  if (!apiBaseUrl || !apiKey || !apiSecret) {
    return { success: false }
  }

  try {
    await $fetch(`${apiBaseUrl}/api/v1/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` },
      body: {
        uid,
        sourceApp: body?.sourceApp || 'align',
        page: body?.page || null,
        status: body?.status || 'active'
      },
      timeout: 3000
    })
    return { success: true }
  } catch {
    // 心跳失败不影响用户体验，静默处理
    return { success: false }
  }
})
