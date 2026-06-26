import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireServiceScope } from '~~/server/utils/serviceAuth'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

export default defineEventHandler(async (event) => {
  requireServiceScope(event, { scope: 'aims:read', allowedApps: ['assets', 'altoc'] })

  const productCode = String(getRouterParam(event, 'productCode') || '').trim()
  if (!productCode) {
    throw createError({ statusCode: 400, message: 'productCode is required.' })
  }

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<unknown>>(event, `/v1/aims/service/products/${encodeURIComponent(productCode)}/versions`, {
    appCode: 'aims',
    scope: 'aims.read',
    method: 'GET'
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for product version service API.'
    })
  }

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw createError({
      statusCode: 502,
      message: envelope.message || 'Aims tenant-runtime returned an error.'
    })
  }

  return { code: 0, data: envelope.data }
})
