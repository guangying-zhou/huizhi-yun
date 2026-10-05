/**
 * 验证 Account API 配置
 * 路由: GET /api/account/config-check
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  const { apiBaseUrl, apiKey, apiSecret } = config.hzy as {
    apiBaseUrl?: string
    apiKey?: string
    apiSecret?: string
  }

  const issues: string[] = []

  if (!apiBaseUrl) issues.push('HZY_ACCOUNT_API_URL 未配置')
  if (!apiKey) issues.push('HZY_ACCOUNT_API_KEY 未配置')
  if (!apiSecret) issues.push('HZY_ACCOUNT_API_SECRET 未配置')

  return {
    valid: issues.length === 0,
    config: {
      apiBaseUrl: apiBaseUrl || '(未配置)',
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret
    },
    issues
  }
})
