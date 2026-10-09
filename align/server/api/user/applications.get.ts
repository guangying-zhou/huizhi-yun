/**
 * GET /api/user/applications
 * 代理 account 模块的应用列表 API，返回当前登录用户可访问的应用
 */
export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const config = useRuntimeConfig()
  const { apiBaseUrl, apiKey, apiSecret } = config.hzy as {
    apiBaseUrl: string
    apiKey: string
    apiSecret: string
  }

  if (!apiBaseUrl || !apiKey || !apiSecret) {
    throw createError({ statusCode: 500, message: 'Account API not configured' })
  }

  const res = await $fetch<{ code: number, data: unknown[] }>(`${apiBaseUrl}/api/v1/applications`, {
    params: { uid },
    headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` },
    timeout: 5000
  })

  return res
})
