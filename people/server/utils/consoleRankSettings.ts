import { createError, getHeader, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface ConsoleSettingsEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ConsoleSettingValue {
  settingKey?: string
  value?: unknown
}

interface ConsoleSettingValues {
  items?: ConsoleSettingValue[]
}

export interface PeopleRankSeriesSettings {
  managementCount: number
  professionalCount: number
  source: 'console' | 'fallback'
}

const MANAGEMENT_COUNT_KEY = 'people.rankSeries.managementCount'
const PROFESSIONAL_COUNT_KEY = 'people.rankSeries.professionalCount'
const DEFAULT_MANAGEMENT_COUNT = 5
const DEFAULT_PROFESSIONAL_COUNT = 10

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
    'x-hzy-tenant-runtime-url',
    'x-hzy-tenant-runtime-token',
    'x-hzy-tenant-runtime-audience',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  return headers
}

function countValue(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

export async function fetchPeopleRankSeriesSettings(event: H3Event): Promise<PeopleRankSeriesSettings> {
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/' })
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })
  }

  const token = await requestServiceAccessToken({
    audience: 'system_settings',
    scope: 'system_settings:view',
    event
  })
  const response = await $fetch<ConsoleSettingsEnvelope<ConsoleSettingValues>>(
    appendPath(baseUrl, '/api/v1/console/settings/values'),
    {
      headers: {
        ...forwardedContextHeaders(event),
        authorization: `Bearer ${token}`
      },
      query: {
        keys: `${MANAGEMENT_COUNT_KEY},${PROFESSIONAL_COUNT_KEY}`
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Console settings API returned an error.' })
  }

  const values = (response.data?.items || []).reduce<Record<string, unknown>>((acc, item) => {
    const key = text(item.settingKey)
    if (key) acc[key] = item.value
    return acc
  }, {})

  return {
    managementCount: countValue(values[MANAGEMENT_COUNT_KEY], DEFAULT_MANAGEMENT_COUNT, 20),
    professionalCount: countValue(values[PROFESSIONAL_COUNT_KEY], DEFAULT_PROFESSIONAL_COUNT, 30),
    source: values[MANAGEMENT_COUNT_KEY] !== undefined || values[PROFESSIONAL_COUNT_KEY] !== undefined ? 'console' : 'fallback'
  }
}
