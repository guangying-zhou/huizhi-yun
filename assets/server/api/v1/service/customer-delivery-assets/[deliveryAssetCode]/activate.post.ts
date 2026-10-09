import { createError, getRouterParam, readBody, setResponseStatus, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { tryDispatchDeliveryAssetStatusOperation } from '~~/server/utils/deliveryAssetStatusOperation'
import { requireServiceScope } from '~~/server/utils/serviceAuth'

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

export default defineEventHandler(async (event) => {
  const deliveryAssetCode = text(getRouterParam(event, 'deliveryAssetCode'))
  if (!deliveryAssetCode) {
    throw createError({ statusCode: 400, message: 'deliveryAssetCode is required.' })
  }
  requireServiceScope(event, { scope: 'assets:write', allowedApps: ['altoc', 'aims'] })

  const body = objectBody(await readBody(event))
  const asset = await activateInAssetsRuntime(event, deliveryAssetCode, body)
  const operation = objectBody((asset as Record<string, unknown>).altocStatusSyncOperation)
  const operationKey = text(operation.operationKey)
  const altocSync = operationKey ? await tryDispatchDeliveryAssetStatusOperation(event, operationKey) : { synced: false, pending: false }
  if (altocSync.pending) setResponseStatus(event, 202)

  return {
    code: 0,
    data: {
      asset,
      altocSync,
      altocSyncStatus: altocSync.synced ? 'succeeded' : altocSync.pending ? 'pending' : 'not_applicable'
    }
  }
})
