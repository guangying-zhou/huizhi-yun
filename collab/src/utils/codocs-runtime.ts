import type { CodocsRuntimeConfig } from '../config.js'

type RuntimeMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

interface RuntimeRequestOptions {
  method?: RuntimeMethod
  query?: Record<string, unknown>
  body?: unknown
}

let runtimeConfig: CodocsRuntimeConfig = {
  endpoint: ''
}

const createRuntimeError = (reason: string) => {
  const error = new Error(reason) as Error & { reason: string }
  error.reason = reason
  return error
}

export const configureCodocsRuntime = (config: CodocsRuntimeConfig): void => {
  runtimeConfig = {
    endpoint: String(config.endpoint || '').trim(),
    token: config.token ? String(config.token).trim() : undefined
  }
}

function appendQuery(url: URL, query: Record<string, unknown>) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }
}

function unwrapRuntimeData<T>(payload: unknown): T {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if ('success' in record && 'data' in record) return record.data as T
    if ('data' in record) return record.data as T
  }
  return payload as T
}

export async function callCodocsRuntime<T>(path: string, options: RuntimeRequestOptions = {}): Promise<T> {
  const endpoint = runtimeConfig.endpoint.replace(/\/+$/, '')
  if (!endpoint) {
    throw createRuntimeError('codocs-runtime-not-configured')
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(normalizedPath, `${endpoint}/`)
  appendQuery(url, options.query || {})

  const method = options.method || 'GET'
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(runtimeConfig.token ? { authorization: `Bearer ${runtimeConfig.token}` } : {}),
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' })
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(options.body || {}) })
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object'
      ? String(
        (payload as { error?: { message?: unknown }, message?: unknown }).error?.message
        || (payload as { message?: unknown }).message
        || response.statusText
      )
      : response.statusText
    throw createRuntimeError(`codocs-runtime-error:${response.status}:${message}`)
  }

  return unwrapRuntimeData<T>(payload)
}
