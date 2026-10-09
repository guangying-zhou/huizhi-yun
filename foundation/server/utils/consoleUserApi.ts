import { createError, getHeader, type H3Event } from 'h3'
import { resolveConsoleUserApiRoute } from '../../shared/utils/consoleUserApiRoutes'
import { consoleServiceFetch } from './consoleServiceBinding'
import { notificationUserForwardHeaders, resolveConsoleNotificationsServerBaseUrl } from './notifications'

type ConsoleApiResponse<T> = { code?: number, data?: T, message?: string }

// Statuses Console returns for the caller's own request. They pass through so
// a missing permission stays 403 and an unavailable dependency stays 503.
const PASS_THROUGH_STATUSES = new Set([400, 401, 403, 404, 409, 412, 422, 429, 503])
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{8,128}$/

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function upstreamStatus(error: unknown) {
  const candidate = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.status || 0)
}

function upstreamMessage(error: unknown) {
  const candidate = error as { data?: { message?: string, statusMessage?: string } }
  return stringValue(candidate?.data?.message || candidate?.data?.statusMessage).slice(0, 200)
}

/**
 * Calls a registered Console user API as the signed-in user.
 *
 * Only routes in `consoleUserApiRoutes` are reachable; the path, query keys
 * and parameters are validated against the registry. The request carries the
 * same verified user credential as the notification proxy (never a service
 * token and never raw caller headers), so Console applies the user's own
 * permission. Writes require the browser's Idempotency-Key.
 */
export async function fetchConsoleUserApi<T>(
  event: H3Event,
  routeId: string,
  options: {
    params?: Record<string, string>
    query?: Record<string, unknown>
    body?: Record<string, unknown> | null
  } = {}
) {
  let resolved
  try {
    resolved = resolveConsoleUserApiRoute(routeId, options.params)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid Console request' })
  }
  const { route, path } = resolved

  const query: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value === undefined) continue
    if (!route.query.includes(key)) throw createError({ statusCode: 400, message: 'Unsupported query parameter' })
    query[key] = value
  }

  const forward = notificationUserForwardHeaders(event)
  if (!forward.headers) throw createError({ statusCode: 401, message: 'Console user credentials are required' })
  if (route.write) {
    const key = stringValue(getHeader(event, 'idempotency-key'))
    if (!IDEMPOTENCY_KEY.test(key)) throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
    forward.headers['idempotency-key'] = key
  }

  const baseUrl = await resolveConsoleNotificationsServerBaseUrl(event)
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Console API URL is not configured' })

  let response: ConsoleApiResponse<T>
  try {
    response = await consoleServiceFetch<ConsoleApiResponse<T>>(event, `${baseUrl}${path}`, {
      method: route.method,
      headers: forward.headers,
      params: query,
      body: route.method === 'GET' ? undefined : (options.body ?? {}),
      timeout: 10000
    })
  } catch (error) {
    const status = upstreamStatus(error)
    console.warn('[console-user-api] request failed', { routeId, statusCode: status || undefined })
    if (PASS_THROUGH_STATUSES.has(status)) {
      throw createError({ statusCode: status, message: upstreamMessage(error) || 'Console request failed' })
    }
    throw createError({ statusCode: 502, message: 'Console request failed' })
  }
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: stringValue(response.message).slice(0, 200) || 'Console request failed' })
  }
  return response.data as T
}
