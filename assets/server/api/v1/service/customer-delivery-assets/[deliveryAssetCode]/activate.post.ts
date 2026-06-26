import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { buildCustomerDeliveryAssetStatusSyncPayload } from '~~/server/utils/customerDeliveryAssetActivationSync'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface CustomerDeliveryAsset {
  delivery_asset_code?: string
  deliveryAssetCode?: string
  source_plan_code?: string
  sourcePlanCode?: string
  contract_code?: string
  contractCode?: string
  contract_line_code?: string
  contractLineCode?: string
  status?: string
  delivered_at?: string
  deliveredAt?: string
  go_live_at?: string
  goLiveAt?: string
  accepted_at?: string
  acceptedAt?: string
  asset_item_code?: string
  assetItemCode?: string
  delivery_view_code?: string
  deliveryViewCode?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
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

function forwardedContextHeaders(event: H3Event, idempotencyKey: string) {
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
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
}

function resolveAltocBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Altoc service API base URL is not configured.' })
  }
  return baseUrl
}

async function activateInAssetsRuntime(event: H3Event, deliveryAssetCode: string, body: Record<string, unknown>) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<CustomerDeliveryAsset>>(
    event,
    `/v1/assets/service/customer-delivery-assets/${encodeURIComponent(deliveryAssetCode)}/activate`,
    {
      appCode: 'assets',
      scope: 'assets.write',
      method: 'POST',
      body
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Assets tenant-runtime is required for this operation.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Assets tenant-runtime returned an error.' })
  }
  return runtime.data.data || {}
}

async function syncAltocDeliveryAssetStatus(
  event: H3Event,
  deliveryAssetCode: string,
  asset: CustomerDeliveryAsset,
  body: Record<string, unknown>
) {
  const payload = buildCustomerDeliveryAssetStatusSyncPayload({
    pathDeliveryAssetCode: deliveryAssetCode,
    asset: asset as Record<string, unknown>,
    body
  })
  const status = payload.status || 'delivered'
  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || `customer-delivery-asset:${deliveryAssetCode}:status:${status}`
  const token = await requestServiceAccessToken({
    audience: 'altoc',
    scope: 'altoc:contract:delivery-asset-status:sync',
    event
  })
  const response = await $fetch<RuntimeEnvelope<Record<string, unknown>>>(
    appendPath(resolveAltocBaseUrl(event), `/api/v1/service/customer-delivery-assets/${encodeURIComponent(deliveryAssetCode)}/status:sync`),
    {
      method: 'POST',
      headers: {
        ...forwardedContextHeaders(event, idempotencyKey),
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: payload,
      timeout: 10000
    }
  )
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Altoc service API returned an error.' })
  }
  return response.data || {}
}

export default defineEventHandler(async (event) => {
  const deliveryAssetCode = text(getRouterParam(event, 'deliveryAssetCode'))
  if (!deliveryAssetCode) {
    throw createError({ statusCode: 400, message: 'deliveryAssetCode is required.' })
  }

  const body = objectBody(await readBody(event))
  const asset = await activateInAssetsRuntime(event, deliveryAssetCode, body)
  let altocSync: Record<string, unknown> | null = null
  let altocSyncError = ''
  try {
    altocSync = await syncAltocDeliveryAssetStatus(event, deliveryAssetCode, asset, body)
  } catch (error) {
    altocSyncError = error instanceof Error ? error.message : String(error || 'Altoc delivery asset status sync failed.')
  }

  return {
    code: 0,
    data: {
      asset,
      altocSync,
      altocSyncStatus: altocSyncError ? 'failed' : 'succeeded',
      ...(altocSyncError ? { altocSyncError } : {})
    }
  }
})
