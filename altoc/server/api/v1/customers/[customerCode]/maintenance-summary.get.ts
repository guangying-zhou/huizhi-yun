import { createError, getRouterParam, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

async function fetchMaintenanceSummary(event: H3Event, customerCode: string, query: Record<string, unknown>) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/altoc/service/customers/${encodeURIComponent(customerCode)}/maintenance-summary`,
    {
      appCode: 'altoc',
      scope: 'altoc.read altoc:customer:view',
      method: 'GET',
      query
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for maintenance summary.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data || {}
}

export default defineEventHandler(async (event) => {
  const customerCode = text(getRouterParam(event, 'customerCode'))
  if (!customerCode) {
    throw createError({ statusCode: 400, message: 'customerCode is required.' })
  }

  await requirePermission(event, 'customer', 'view')
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'customer', 'view')
  const data = await fetchMaintenanceSummary(event, customerCode, dataAccessQuery)
  return { code: 0, message: 'ok', data }
})
