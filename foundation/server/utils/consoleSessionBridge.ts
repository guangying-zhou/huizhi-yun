import { createError, getCookie, getHeader, type H3Event } from 'h3'
import { resolveConsoleAuthContext, type ConsoleAuthRequestContext } from './consoleOidc'
import { getRequestOrigin } from './appUrls'
import { resolveConsoleRuntimeBaseUrl, resolveConsoleRuntimeSeedConfig } from './consoleRuntime'
import { consoleServiceBinding, consoleServiceFetch } from './consoleServiceBinding'
import { trustedServiceRequestHeaders } from './serviceOidc'

interface ConsoleAuthMeResponse {
  code?: number
  data?: {
    authenticated?: boolean
    subject?: {
      uid?: string | null
      subjectCode?: string | null
    } | null
    directory?: {
      uid?: string | null
    } | null
  }
}

const consoleSessionBridgePromiseKey = Symbol('hzy.consoleSessionBridge.promise')

type ConsoleSessionBridgeEventContext = H3Event['context'] & {
  [consoleSessionBridgePromiseKey]?: Promise<ConsoleAuthRequestContext | null>
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getConfigValue(event: H3Event, keys: string[]) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>

  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }

      current = (current as Record<string, unknown>)[part]
    }

    const normalized = stringValue(current)
    if (normalized) return normalized
  }

  return ''
}

function normalizeConsoleUrl(value: unknown) {
  return stringValue(value)
    .replace(/[?#].*$/, '')
    .replace(/\/admin\/?$/i, '')
    .replace(/\/+$/, '')
}

function consoleBridgeForwardHeaders(event: H3Event) {
  const cookie = stringValue(getHeader(event, 'cookie'))
  if (!cookie) return null

  const headers: Record<string, string> = { cookie }
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
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
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }

  try {
    const requestOrigin = new URL(getRequestOrigin(event))
    if (!headers['x-forwarded-host'] && requestOrigin.host) {
      headers['x-forwarded-host'] = requestOrigin.host
    }
    if (!headers['x-forwarded-proto'] && requestOrigin.protocol) {
      headers['x-forwarded-proto'] = requestOrigin.protocol.replace(/:$/, '')
    }
  } catch {
    // Ignore malformed origin input and keep the copied headers.
  }

  return {
    ...headers,
    ...(consoleServiceBinding(event) ? trustedServiceRequestHeaders(event, 'console') : {})
  }
}

function getConsoleAuthMeUrl(event: H3Event) {
  const consoleUrl = getConsoleSessionBridgeBaseUrl(event)
  return consoleUrl ? `${consoleUrl}/api/v1/console/auth/me` : ''
}

function getConsoleSessionBridgeBaseUrl(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const runtimeConsoleUrl = resolveConsoleRuntimeSeedConfig(
    config as { hzy?: Record<string, unknown>, public?: Record<string, unknown> },
    event
  ).consoleApiUrl
  return normalizeConsoleUrl(runtimeConsoleUrl || getConfigValue(event, [
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.integration.consoleApiUrl'
  ]) || process.env.HZY_CONSOLE_URL || process.env.HZY_CONSOLE_API_URL || resolveConsoleRuntimeBaseUrl(config))
}

function isConsoleApp(event: H3Event) {
  return getConfigValue(event, ['public.appCode', 'public.appName']).toLowerCase() === 'console'
}

export function shouldTryConsoleSessionBridge(
  event: H3Event,
  consoleAuth: ConsoleAuthRequestContext,
  options: { allowConsoleApp?: boolean } = {}
) {
  if (consoleAuth.authenticated) return false
  if (!options.allowConsoleApp && isConsoleApp(event)) return false

  return Boolean(
    getCookie(event, 'console_session')
    || (getCookie(event, 'token') && getCookie(event, 'auth_user'))
  )
}

async function loadConsoleSessionBridge(event: H3Event): Promise<ConsoleAuthRequestContext | null> {
  const url = getConsoleAuthMeUrl(event)
  const headers = consoleBridgeForwardHeaders(event)
  if (!url || !headers) {
    console.warn('[console-bridge] skipped:', { hasUrl: Boolean(url), hasCookie: Boolean(headers) })
    return null
  }

  try {
    const res = await consoleServiceFetch<ConsoleAuthMeResponse>(event, url, {
      headers,
      timeout: 3000
    })
    const data = res.data
    const uid = stringValue(data?.subject?.uid || data?.directory?.uid)
    if (!data?.authenticated || !uid) {
      console.warn('[console-bridge] auth/me returned no user:', { authenticated: Boolean(data?.authenticated), hasUid: Boolean(uid) })
      return null
    }

    return {
      authenticated: true,
      token: stringValue(getCookie(event, 'token') || getCookie(event, 'console_session')) || undefined,
      tokenUse: 'legacy_session',
      subjectType: 'user',
      uid,
      subjectCode: stringValue(data.subject?.subjectCode || uid) || undefined
    }
  } catch (error) {
    console.warn('[console-bridge] auth/me request failed:', url, error instanceof Error ? error.message : String(error))
    return null
  }
}

export function resolveConsoleSessionBridge(event: H3Event): Promise<ConsoleAuthRequestContext | null> {
  const context = event.context as ConsoleSessionBridgeEventContext
  context[consoleSessionBridgePromiseKey] ||= loadConsoleSessionBridge(event)
  return context[consoleSessionBridgePromiseKey]
}

export async function resolveConsoleAuthWithSessionBridge(
  event: H3Event,
  options: { allowConsoleApp?: boolean } = {}
): Promise<ConsoleAuthRequestContext> {
  const existing = event.context.consoleAuth as ConsoleAuthRequestContext | undefined
  if (existing?.authenticated) return existing

  const consoleAuth = await resolveConsoleAuthContext(event)
  if (!shouldTryConsoleSessionBridge(event, consoleAuth, options)) {
    return consoleAuth
  }

  return await resolveConsoleSessionBridge(event) || consoleAuth
}

export async function fetchConsoleSessionApi<T>(
  event: H3Event,
  path: `/api/${string}`,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: unknown
    query?: Record<string, unknown>
    timeout?: number
  } = {}
) {
  const baseUrl = getConsoleSessionBridgeBaseUrl(event)
  const headers = consoleBridgeForwardHeaders(event)
  if (!baseUrl || !headers) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Console session runtime is unavailable',
      data: { code: 'console_session_runtime_unavailable' }
    })
  }

  try {
    return await consoleServiceFetch<T>(event, `${baseUrl}${path}`, {
      ...options,
      params: options.query,
      headers,
      timeout: options.timeout ?? 3000
    })
  } catch (error) {
    const upstream = error as { status?: number, statusCode?: number, response?: { status?: number } }
    const upstreamStatus = Number(upstream.response?.status || upstream.statusCode || upstream.status || 0)
    const statusCode = upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 503
    throw createError({
      statusCode,
      statusMessage: statusCode === 503 ? 'Service Unavailable' : undefined,
      message: statusCode === 401
        ? '请先登录'
        : statusCode === 403
          ? '当前用户无权执行此操作'
          : statusCode === 503
            ? 'Console session runtime is unavailable'
            : 'Console session request was rejected',
      data: statusCode === 503 ? { code: 'console_session_runtime_unavailable' } : undefined,
      cause: error
    })
  }
}
