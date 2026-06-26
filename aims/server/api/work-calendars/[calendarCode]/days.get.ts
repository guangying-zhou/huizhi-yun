import { createError, getHeader, getQuery, getRouterParam, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface ServiceEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface WorkCalendarDayPage {
  items?: Array<Record<string, unknown>>
}

interface WorkCalendarMonth {
  standardHoursPerDay?: number | string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  const base = trimTrailingSlash(baseUrl)
  const normalizedPath = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalizedPath.startsWith('api/v1/')) {
    return `${base}/${normalizedPath.slice('api/v1/'.length)}`
  }
  if (base.endsWith('/api') && normalizedPath.startsWith('api/')) {
    return `${base}/${normalizedPath.slice('api/'.length)}`
  }
  return `${base}/${normalizedPath}`
}

function forwardedContextHeaders(event: H3Event) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  return headers
}

function resolveConsoleBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/' })
  if (!baseUrl) {
    throw createError({
      statusCode: 503,
      message: 'Console service API base URL is not configured.'
    })
  }
  return baseUrl
}

function normalizeCalendarCode(value: unknown) {
  const calendarCode = text(value || 'CN').toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(calendarCode)) {
    throw createError({ statusCode: 400, message: 'invalid calendarCode' })
  }
  return calendarCode
}

function normalizeYearMonth(value: unknown) {
  const yearMonth = text(value)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw createError({ statusCode: 400, message: 'yearMonth must be YYYY-MM' })
  }
  return yearMonth
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const calendarCode = normalizeCalendarCode(getRouterParam(event, 'calendarCode'))
  const yearMonth = normalizeYearMonth(query.yearMonth || query.year_month)
  const token = await requestServiceAccessToken({
    audience: 'system_settings',
    scope: 'system_settings:view',
    event
  })

  const consoleBaseUrl = resolveConsoleBaseUrl(event)
  const params = new URLSearchParams({ yearMonth })
  const headers = {
    ...forwardedContextHeaders(event),
    authorization: `Bearer ${token}`
  }
  const [daysResponse, monthResponse] = await Promise.all([
    $fetch<ServiceEnvelope<WorkCalendarDayPage>>(
      `${appendPath(consoleBaseUrl, `/api/v1/console/work-calendars/${encodeURIComponent(calendarCode)}/days`)}?${params.toString()}`,
      {
        headers,
        timeout: 10000
      }
    ),
    $fetch<ServiceEnvelope<WorkCalendarMonth>>(
      appendPath(consoleBaseUrl, '/api/v1/console/service/work-calendar/month'),
      {
        query: { calendarCode, yearMonth },
        headers,
        timeout: 10000
      }
    ).catch(() => null)
  ])

  if (daysResponse.code !== undefined && daysResponse.code !== 0) {
    throw createError({
      statusCode: 502,
      message: daysResponse.message || 'Console work calendar API returned an error.'
    })
  }

  const standardHoursPerDay = numberValue(monthResponse?.data?.standardHoursPerDay, 8)

  return {
    code: 0,
    data: {
      month: monthResponse?.data || null,
      items: (daysResponse.data?.items || []).map(item => ({
        ...item,
        standardHoursPerDay
      }))
    }
  }
})
