/**
 * Console Directory API adapter.
 *
 * New directory-runtime integrations should use this helper instead of
 * calling Account directly. It intentionally supports only the target
 * Console provider; legacy Account calls stay in accountApi.ts.
 */
import { resolveConsoleRuntimeBaseUrl } from './consoleRuntime'

export type DirectoryProvider = 'console'

export interface DirectoryConfig {
  provider: DirectoryProvider
  consoleApiUrl: string
  consoleClientId?: string
  consoleClientSecret?: string
  timeoutMs: number
}

interface RuntimeConfigWithDirectory {
  hzy?: {
    directory?: {
      provider?: string
      consoleApiUrl?: string
      consoleClientId?: string
      consoleClientSecret?: string
      timeoutMs?: number
    }
    directoryProvider?: string
    consoleApiUrl?: string
    consoleClientId?: string
    consoleClientSecret?: string
  }
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function getCurrentAppCode() {
  const runtimeConfig = useRuntimeConfig() as unknown as {
    public?: {
      appCode?: string
      appName?: string
    }
  }
  return String(runtimeConfig.public?.appCode || runtimeConfig.public?.appName || '').trim()
}

function localFetch<T>(path: string, options: {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  params?: Record<string, unknown>
  body?: unknown
  timeout?: number
} = {}) {
  const local = $fetch as unknown as <R>(request: string, options: {
    method?: string
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  }) => Promise<R>

  return local<T>(path, {
    method: options.method,
    params: options.params,
    body: options.body,
    timeout: options.timeout
  })
}

export function getDirectoryConfig(): DirectoryConfig {
  const runtimeConfig = useRuntimeConfig() as unknown as RuntimeConfigWithDirectory
  const hzy = runtimeConfig.hzy
  const directory = hzy?.directory
  const consoleRuntimeBaseUrl = resolveConsoleRuntimeBaseUrl(runtimeConfig as unknown as Record<string, unknown>)
  const provider = String(
    directory?.provider
    || hzy?.directoryProvider
    || process.env.HZY_DIRECTORY_PROVIDER
    || (consoleRuntimeBaseUrl ? 'console' : '')
  ).trim()

  return {
    provider: provider as DirectoryProvider,
    consoleApiUrl: normalizeBaseUrl(String(
      directory?.consoleApiUrl
      || hzy?.consoleApiUrl
      || process.env.HZY_CONSOLE_API_URL
      || consoleRuntimeBaseUrl
      || ''
    ).trim()),
    consoleClientId: String(
      directory?.consoleClientId
      || hzy?.consoleClientId
      || process.env.HZY_CONSOLE_CLIENT_ID
      || ''
    ).trim() || undefined,
    consoleClientSecret: String(
      directory?.consoleClientSecret
      || hzy?.consoleClientSecret
      || process.env.HZY_CONSOLE_CLIENT_SECRET
      || ''
    ).trim() || undefined,
    timeoutMs: Number(directory?.timeoutMs || process.env.HZY_DIRECTORY_TIMEOUT_MS || 10000)
  }
}

export function isConsoleDirectoryProvider() {
  return getDirectoryConfig().provider === 'console'
}

export function requireDirectoryConfig(): DirectoryConfig {
  const config = getDirectoryConfig()
  if (config.provider !== 'console') {
    throw createError({
      statusCode: 500,
      statusMessage: 'DIR_CONFIG_MISSING',
      message: 'HZY_DIRECTORY_PROVIDER must be set to console'
    })
  }
  if (!config.consoleApiUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'DIR_CONFIG_MISSING',
      message: 'HZY_CONSOLE_API_URL is required when HZY_DIRECTORY_PROVIDER=console'
    })
  }
  return config
}

export function getDirectoryAuthHeaders(config = requireDirectoryConfig()): Record<string, string> {
  if (!config.consoleClientId || !config.consoleClientSecret) {
    return {}
  }

  const credentials = Buffer.from(`${config.consoleClientId}:${config.consoleClientSecret}`).toString('base64')
  return {
    Authorization: `Basic ${credentials}`
  }
}

export async function fetchDirectoryApi<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  } = {}
): Promise<T> {
  const config = requireDirectoryConfig()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const externalFetch = $fetch as unknown as <R>(request: string, options: {
    method?: string
    headers?: Record<string, string>
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  }) => Promise<R>

  try {
    return await externalFetch<T>(`${config.consoleApiUrl}${normalizedPath}`, {
      method: options.method,
      headers: getDirectoryAuthHeaders(config),
      params: options.params,
      body: options.body,
      timeout: options.timeout || config.timeoutMs
    })
  } catch (error: unknown) {
    const err = error as { message?: string, statusCode?: number, statusMessage?: string }
    throw createError({
      statusCode: err.statusCode || 502,
      statusMessage: err.statusMessage || 'DIR_UPSTREAM_UNAVAILABLE',
      message: err.message || 'Console Directory API unavailable'
    })
  }
}

export async function fetchConsoleDirectoryApi<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  } = {}
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (getCurrentAppCode() === 'console') {
    if (normalizedPath === '/meta') {
      return localFetch<T>(`/api/v1/console/directory${normalizedPath}`, options)
    }
    return localFetch<T>(`/api/v1/directory${normalizedPath}`, options)
  }

  try {
    return await fetchDirectoryApi<T>(`/api/v1/console/directory${normalizedPath}`, options)
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0

    if (statusCode !== 401 && statusCode !== 403) {
      throw error
    }

    return fetchDirectoryApi<T>(`/api/v1/directory${normalizedPath}`, options)
  }
}

export async function fetchConsoleApi<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  } = {}
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return fetchDirectoryApi<T>(`/api/v1/console${normalizedPath}`, options)
}
