import { createError, getHeader, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

export interface FinancePerformanceAmountQuery {
  cycleCode?: string
  employeeUid?: string
  projectCode?: string
  periodMonth?: string
  periodStart?: string
  periodEnd?: string
  page?: number
  pageSize?: number
}

export interface FinancePerformanceAmountResponse {
  data?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
  warning?: string
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

function appendQuery(params: URLSearchParams, key: string, value: unknown) {
  const content = text(value)
  if (content) params.set(key, content)
}

export async function fetchFinancePerformanceAmounts(event: H3Event, input: FinancePerformanceAmountQuery) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'finance')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Finance service API base URL is not configured.' })
  }

  const params = new URLSearchParams()
  appendQuery(params, 'cycle_code', input.cycleCode)
  appendQuery(params, 'employee_uid', input.employeeUid)
  appendQuery(params, 'project_code', input.projectCode)
  appendQuery(params, 'period_month', input.periodMonth)
  appendQuery(params, 'period_start', input.periodStart)
  appendQuery(params, 'period_end', input.periodEnd)
  params.set('page', String(input.page || 1))
  params.set('pageSize', String(Math.min(Math.max(input.pageSize || 100, 1), 100)))

  const token = await requestServiceAccessToken({
    audience: 'finance',
    scope: 'finance:read',
    event
  })
  const response = await $fetch<RuntimeEnvelope<FinancePerformanceAmountResponse>>(
    `${appendPath(baseUrl, '/api/v1/finance/service/performance-amounts')}?${params.toString()}`,
    {
      headers: {
        ...forwardedContextHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Finance performance amount API returned an error.' })
  }

  return response.data || { data: [], total: 0, page: 1, pageSize: input.pageSize || 100 }
}
