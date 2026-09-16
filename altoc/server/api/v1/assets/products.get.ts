import { createError, getQuery } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
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

  const response = await serviceAppFetch<RuntimeEnvelope<unknown>>(event, 'assets', `${appendPath(baseUrl, '/api/v1/service/products')}?${params.toString()}`,
    {
      headers: {
        ...crossAppForwardedHeaders(event),
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
