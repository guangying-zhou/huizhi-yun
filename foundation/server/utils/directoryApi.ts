/**
 * Console Directory API adapter.
 *
 * New directory-runtime integrations should use this helper instead of
 * calling Account directly. It intentionally supports only the target
 * Console provider; legacy Account calls stay in accountApi.ts.
 */
import { getHeader, type H3Event } from 'h3'
import { directoryActiveStatusData } from './directoryActiveStatusData'
import { consoleServiceFetch } from './consoleServiceBinding'
import { resolveConsoleRuntimeBaseUrl } from './consoleRuntime'
import {
  requestWithServiceAccessToken,
  trustedServiceRequestHeaders
} from './serviceOidc'

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
  event?: H3Event
} = {}) {
  type LocalFetch = <R>(request: string, options: {
    method?: string
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  }) => Promise<R>

  // Nitro's event-local fetch keeps the verified request/session context while
  // dispatching internally. This avoids a Console Worker public subrequest back
  // into itself, which Cloudflare eventually terminates with HTTP 522.
  const eventFetch = (options.event as unknown as { $fetch?: LocalFetch } | undefined)?.$fetch
  const local: LocalFetch = eventFetch || ($fetch as unknown as LocalFetch)

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

const forwardedConsoleHeaderNames = [
  'x-hzy-gateway',
  'x-hzy-gateway-token',
  'x-hzy-tenant',
  // Tenant Gateway binds x-hzy-deployment to the caller application. Do not
  // reuse that identity for Console authorization; Console resolves its own
  // target deployment while retaining the tenant Runtime transport context.
  'x-hzy-environment',
  'x-hzy-app-code',
  'x-hzy-data-runtime-url',
  'x-hzy-data-runtime-code',
  'x-hzy-data-runtime-token',
  'x-hzy-data-runtime-audience',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-proto'
] as const

export function getDirectoryAuthHeaders(
  config = requireDirectoryConfig(),
  event?: H3Event
): Record<string, string> {
  const headers: Record<string, string> = {}

  if (config.consoleClientId && config.consoleClientSecret) {
    const credentials = Buffer.from(`${config.consoleClientId}:${config.consoleClientSecret}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
  }

  if (!event) return headers

  const cookie = String(getHeader(event, 'cookie') || '').trim()
  if (cookie) headers.cookie = cookie

  for (const name of forwardedConsoleHeaderNames) {
    const value = String(getHeader(event, name) || '').trim()
    if (value) headers[name] = value
  }

  return headers
}

export async function fetchDirectoryApi<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
    event?: H3Event
  } = {}
): Promise<T> {
  const config = requireDirectoryConfig()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  try {
    // 必须经 Console Service Binding：Worker 子请求走公网会被生产 zone 的
    // CN_CA_JP 规则判为 country=US 拦成 403（走查 ISSUE-B-025 实测）。
    return await consoleServiceFetch<T>(options.event, `${config.consoleApiUrl}${normalizedPath}`, {
      method: options.method,
      headers: getDirectoryAuthHeaders(config, options.event),
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

async function fetchDirectorySharingByService<T>(options: {
  params?: Record<string, unknown>
  timeout?: number
  event?: H3Event
}, projection?: 'departments') {
  const config = requireDirectoryConfig()
  return await requestWithServiceAccessToken<T>({
    audience: 'console',
    scope: 'console:directory-users:read',
    event: options.event,
    request: token => consoleServiceFetch<T>(
      options.event,
      `${config.consoleApiUrl}/api/v1/console/service/directory/users`,
      {
        headers: {
          ...trustedServiceRequestHeaders(options.event),
          authorization: `Bearer ${token}`
        },
        params: {
          ...options.params,
          ...(projection ? { projection } : {})
        },
        timeout: options.timeout || config.timeoutMs
      }
    )
  })
}

export async function fetchConsoleBusinessDomainsByService<T = unknown>(options: {
  params?: Record<string, unknown>
  timeout?: number
  event?: H3Event
} = {}) {
  if (getCurrentAppCode() === 'console') {
    return fetchConsoleApi<T>('/business-domains', options)
  }

  const config = requireDirectoryConfig()
  return await requestWithServiceAccessToken<T>({
    audience: 'console',
    scope: 'console:business-domain:view',
    event: options.event,
    request: token => consoleServiceFetch<T>(
      options.event,
      `${config.consoleApiUrl}/api/v1/console/service/business-domains`,
      {
        headers: {
          ...trustedServiceRequestHeaders(options.event),
          authorization: `Bearer ${token}`
        },
        params: options.params,
        timeout: options.timeout || config.timeoutMs
      }
    )
  })
}

type DirectorySharingEnvelope<T> = {
  code: number
  message?: string
  data?: T
}

async function fetchDirectorySharingUserByService<T>(uid: string, options: {
  params?: Record<string, unknown>
  timeout?: number
  event?: H3Event
}) {
  const response = await fetchDirectorySharingByService<DirectorySharingEnvelope<Record<string, unknown>[]>>({
    ...options,
    params: { ...options.params, uids: uid }
  })
  const user = Array.isArray(response.data)
    ? response.data.find(item => String(item.uid || '').trim() === uid)
    : undefined

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'DIR_USER_NOT_FOUND',
      message: `Directory user ${uid} not found`
    })
  }

  return {
    ...response,
    data: user
  } as T
}

/** Minimal current Directory state for an explicit, bounded UID set. */
export async function fetchDirectoryActiveStatuses(event: H3Event, uids: string[]): Promise<Array<{ uid: string, active: boolean }>> {
  const unique = [...new Set(uids)]
  if (!unique.length || unique.length > 100 || unique.some(uid => !uid || uid !== uid.trim() || uid.includes(',') || uid.length > 128)) {
    throw createError({ statusCode: 400, message: 'invalid_directory_status_uids' })
  }
  const response = await fetchDirectorySharingByService<DirectorySharingEnvelope<Array<{ uid: string, active: boolean }>>>({
    event, params: { uids: unique.join(','), projection: 'active-status' }
  })
  const rows = directoryActiveStatusData(unique, response)
  if (!rows) {
    throw createError({ statusCode: 503, message: 'directory_active_status_unavailable' })
  }
  return rows
}

export async function fetchConsoleDirectoryApi<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
    event?: H3Event
  } = {}
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (getCurrentAppCode() === 'console') {
    if (normalizedPath === '/meta') {
      return localFetch<T>(`/api/v1/console/directory${normalizedPath}`, options)
    }
    return localFetch<T>(`/api/v1/directory${normalizedPath}`, options)
  }

  if (normalizedPath === '/departments' && (!options.method || options.method === 'GET')) {
    return fetchDirectorySharingByService<T>(options, 'departments')
  }

  if (normalizedPath === '/users' && (!options.method || options.method === 'GET')) {
    return fetchDirectorySharingByService<T>(options)
  }

  const userDetailMatch = normalizedPath.match(/^\/users\/([^/]+)$/)
  if (userDetailMatch && (!options.method || options.method === 'GET')) {
    const uid = decodeURIComponent(userDetailMatch[1] || '').trim()
    if (!uid) {
      throw createError({ statusCode: 400, message: 'uid is required' })
    }
    return fetchDirectorySharingUserByService<T>(uid, options)
  }

  // Directory reads contain employee PII. A 401/403 from the protected
  // Console route is an authorization decision, never a reason to retry a
  // legacy route with weaker access controls.
  return fetchDirectoryApi<T>(`/api/v1/console/directory${normalizedPath}`, options)
}

export async function fetchConsoleApi<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
    event?: H3Event
  } = {}
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (getCurrentAppCode() === 'console') {
    return localFetch<T>(`/api/v1/console${normalizedPath}`, options)
  }
  return fetchDirectoryApi<T>(`/api/v1/console${normalizedPath}`, options)
}
