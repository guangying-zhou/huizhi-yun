interface AccountApiConfig {
  apiBaseUrl?: string
  apiKey?: string
  apiSecret?: string
}

export function getAccountApiConfig(): AccountApiConfig {
  const config = useRuntimeConfig()
  const { apiBaseUrl, apiKey, apiSecret } = (config.hzy || {}) as AccountApiConfig

  return { apiBaseUrl, apiKey, apiSecret }
}

export function requireAccountApiConfig(): Required<AccountApiConfig> {
  const config = getAccountApiConfig()

  if (!config.apiBaseUrl || !config.apiKey || !config.apiSecret) {
    throw createError({
      statusCode: 500,
      message: 'Account API configuration is missing'
    })
  }

  return {
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret
  }
}

export function getAccountApiAuthHeaders() {
  const { apiKey, apiSecret } = requireAccountApiConfig()

  return {
    Authorization: `Bearer ${apiKey}:${apiSecret}`
  }
}
