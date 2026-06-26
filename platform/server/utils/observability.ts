type ObservabilityRequestOptions = {
  method?: 'GET' | 'PUT'
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
}

function normalizeBaseUrl(value: unknown) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function getObservabilityConfig() {
  const config = useRuntimeConfig()
  const observability = (config.observability || {}) as {
    apiUrl?: string
    adminToken?: string
  }

  return {
    apiUrl: normalizeBaseUrl(observability.apiUrl || process.env.HZY_OBSERVABILITY_API_URL),
    adminToken: String(observability.adminToken || process.env.HZY_OBSERVABILITY_ADMIN_TOKEN || '').trim()
  }
}

export async function requestObservability<T>(path: string, options: ObservabilityRequestOptions = {}): Promise<T> {
  const config = getObservabilityConfig()

  if (!config.apiUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'observability API is not configured'
    })
  }

  const url = new URL(path, `${config.apiUrl}/`)
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  try {
    return await $fetch(url.toString(), {
      method: options.method || 'GET',
      body: options.body as Record<string, unknown> | BodyInit | null | undefined,
      headers: config.adminToken
        ? {
            'x-hzy-observability-token': config.adminToken
          }
        : undefined
    }) as T
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: extractFetchErrorMessage(error, 'observability API request failed')
    })
  }
}

function extractFetchErrorMessage(error: unknown, fallback: string) {
  const record = error as {
    data?: {
      message?: string
      error?: string
      statusMessage?: string
    }
    message?: string
  } | null

  return record?.data?.message || record?.data?.error || record?.data?.statusMessage || record?.message || fallback
}
