import { createError, type H3Event } from 'h3'

type FetchOptions = {
  method?: string
  body?: FetchBody
  query?: Record<string, string | number | undefined>
}

type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type FetchBody = BodyInit | Record<string, unknown> | string | null

type UpstreamFetchError = {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
}

function cleanBaseUrl(input: unknown) {
  return String(input || '').trim().replace(/\/+$/, '')
}

type CloudflareEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}

function cloudflareEnv(event?: H3Event): CloudflareEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent | undefined
  return runtimeEvent?.context?.cloudflare?.env
    || runtimeEvent?.context?._platform?.cloudflare?.env
    || runtimeEvent?.req?.runtime?.cloudflare?.env
    || {}
}

function envValue(event: H3Event | undefined, names: string[]) {
  const env = cloudflareEnv(event)
  for (const name of names) {
    const value = String(env[name] || process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

function normalizeMethod(value: unknown): FetchMethod | undefined {
  const method = String(value || '').trim().toUpperCase()
  if (method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return method
  }
  return undefined
}

export async function devAgentFetch<T = unknown>(event: H3Event, path: string, options: FetchOptions = {}): Promise<T> {
  const config = useRuntimeConfig()
  const baseUrl = cleanBaseUrl(config.devAgent?.baseUrl || envValue(event, ['HZY_WEBDEV_DEV_AGENT_URL']))
  const token = String(config.devAgent?.token || envValue(event, ['HZY_WEBDEV_DEV_AGENT_TOKEN']) || '').trim()

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Dev Agent endpoint is not configured'
    })
  }

  const headers: Record<string, string> = {}
  if (token) {
    headers.authorization = `Bearer ${token}`
  }

  try {
    const response = await $fetch<unknown>(`${baseUrl}${path}`, {
      method: normalizeMethod(options.method),
      body: options.body,
      query: options.query,
      headers
    })
    return response as T
  } catch (error: unknown) {
    const fetchError = error as UpstreamFetchError
    throw createError({
      statusCode: fetchError.statusCode || 502,
      statusMessage: fetchError.statusMessage || fetchError.message || 'Dev Agent request failed',
      data: fetchError.data
    })
  }
}
