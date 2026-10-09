import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { productVersionSummaries } from '~~/server/utils/productVersionSummary'
import { createError, getRouterParam, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveAssetsObjectScopeQuery } from '~~/server/utils/assetsScopedAuthorization'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { extractServiceOperationStatus } from '@hzy/foundation/server/utils/serviceOperation'

function summaryReadError(envelope: unknown) {
  const upstream = extractServiceOperationStatus(envelope)
  const statusCode = upstream && [400, 401, 403, 404, 409, 422, 429].includes(upstream) ? upstream : 503
  return createError({ statusCode, message: '产品版本摘要暂时无法读取', data: { upstreamStatus: statusCode } })
}

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
  const uid = requireRequestUid(event)
  const objectScope = await resolveAssetsObjectScopeQuery(event, uid, 'products', 'view')
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<AssetProduct>>(event, `/v1/assets/products/${encodeURIComponent(id)}`, {
    appCode: 'assets',
    scope: 'assets.read',
    method: 'GET',
    query: { ...objectScope, current_user: uid }
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Assets tenant-runtime is required for product version lookup.'
    })
  }

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw summaryReadError(envelope)
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

  await requirePermission(event, 'products', 'view')
  const productCode = await getAssetProduct(event, id)
  const token = await requestServiceAccessToken({
    audience: 'aims',
    scope: 'aims:product-version-summary:read',
    event
  })
  const aimsBaseUrl = resolveAimsBaseUrl(event)
  const response = await serviceAppFetch<RuntimeEnvelope<AimsVersionsResponse>>(
    event, 'aims',
    appendPath(aimsBaseUrl, `/api/v1/service/products/${encodeURIComponent(productCode)}/version-summaries`),
    {
      headers: {
        ...trustedServiceRequestHeaders(event, 'aims'),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw summaryReadError(response)
  }

  return {
    code: 0,
    data: {
      productCode,
      items: productVersionSummaries(response.data?.items, productCode)
    }
  }
})
