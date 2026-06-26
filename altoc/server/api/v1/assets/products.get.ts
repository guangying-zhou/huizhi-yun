import { createError, getHeader, getQuery, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
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

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'contract', 'edit')

  const baseUrl = resolveServiceAppBaseUrl(event, 'assets')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  }

  const query = getQuery(event)
  const params = new URLSearchParams()
  const keyword = text(query.keyword || query.search || query.q)
  const codes = text(query.codes || query.product_codes || query.productCodes)
  const pageSize = Number(query.pageSize || query.page_size || 20)
  if (keyword) params.set('keyword', keyword)
  if (codes) params.set('codes', codes)
  params.set('pageSize', String(Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20))

  const token = await requestServiceAccessToken({
    audience: 'assets',
    scope: 'assets:read',
    event
  })

  const response = await $fetch<RuntimeEnvelope<unknown>>(
    `${appendPath(baseUrl, '/api/v1/service/products')}?${params.toString()}`,
    {
      headers: {
        ...forwardedContextHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Assets service API returned an error.' })
  }

  return {
    code: 0,
    message: 'ok',
    data: response.data ?? response
  }
})
