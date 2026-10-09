import { createError, getQuery, getRouterParam, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function httpStatus(error: unknown) {
  const err = error as { status?: number, statusCode?: number, response?: { status?: number } }
  return err?.statusCode || err?.status || err?.response?.status || 0
}

async function assertCustomerScope(event: H3Event, customerCode: string, query: Record<string, unknown>) {
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
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for customer scope.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
}

export default defineEventHandler(async (event) => {
  const customerCode = text(getRouterParam(event, 'customerCode'))
  if (!customerCode) {
    throw createError({ statusCode: 400, message: 'customerCode is required.' })
  }

  await requirePermission(event, 'customer', 'view')
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'customer', 'view')
  await assertCustomerScope(event, customerCode, dataAccessQuery)

  const baseUrl = resolveServiceAppBaseUrl(event, 'assets')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  }

  const query = getQuery(event)
  const params = new URLSearchParams()
  params.set('customer_code', customerCode)
  for (const key of ['contract_code', 'project_code']) {
    const value = text(query[key])
    if (value) params.set(key, value)
  }

  const token = await requestServiceAccessToken({
    audience: 'assets',
    scope: 'assets:read',
    event
  })
  let response: RuntimeEnvelope<unknown>
  try {
    response = await serviceAppFetch<RuntimeEnvelope<unknown>>(event, 'assets', `${appendPath(baseUrl, '/api/v1/service/deliveries/package')}?${params.toString()}`,
      {
        headers: {
          ...crossAppForwardedHeaders(event),
          authorization: `Bearer ${token}`
        },
        timeout: 10000
      }
    )
  } catch (error: unknown) {
    if (httpStatus(error) === 404) {
      throw createError({ statusCode: 502, message: 'Assets delivery package endpoint was not found.' })
    }
    throw error
  }

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Assets service API returned an error.' })
  }

  return {
    code: 0,
    message: 'ok',
    data: response.data ?? response
  }
})
