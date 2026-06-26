import { createError, getHeader, getRouterParam, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface AssetProduct {
  product_code?: string
  productCode?: string
}

interface AimsVersionsResponse {
  items?: Array<Record<string, unknown>>
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
  return headers
}

function resolveAimsBaseUrl(event: H3Event) {
  const configured = resolveServiceAppBaseUrl(event, 'aims')
  if (!configured) {
    throw createError({
      statusCode: 503,
      message: 'Aims service API base URL is not configured.'
    })
  }
  return configured
}

async function getAssetProduct(event: H3Event, id: string) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<AssetProduct>>(event, `/v1/assets/products/${encodeURIComponent(id)}`, {
    appCode: 'assets',
    scope: 'assets.read',
    method: 'GET'
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Assets tenant-runtime is required for product version lookup.'
    })
  }

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw createError({
      statusCode: 502,
      message: envelope.message || 'Assets tenant-runtime returned an error.'
    })
  }

  const productCode = text(envelope.data?.product_code || envelope.data?.productCode)
  if (!productCode) {
    throw createError({ statusCode: 404, message: 'Product code is missing.' })
  }
  return productCode
}

export default defineEventHandler(async (event) => {
  const id = text(getRouterParam(event, 'id'))
  if (!id) {
    throw createError({ statusCode: 400, message: 'Product id is required.' })
  }

  const productCode = await getAssetProduct(event, id)
  const token = await requestServiceAccessToken({
    audience: 'aims',
    scope: 'aims:read',
    event
  })
  const aimsBaseUrl = resolveAimsBaseUrl(event)
  const response = await $fetch<RuntimeEnvelope<AimsVersionsResponse>>(
    appendPath(aimsBaseUrl, `/api/v1/service/products/${encodeURIComponent(productCode)}/versions`),
    {
      headers: {
        ...forwardedContextHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Aims service API returned an error.'
    })
  }

  return {
    code: 0,
    data: {
      productCode,
      items: response.data?.items || []
    }
  }
})
