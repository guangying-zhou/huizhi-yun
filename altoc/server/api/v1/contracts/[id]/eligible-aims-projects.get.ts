import { createError, getHeader, getQuery, getRouterParam, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ContractForProjectLookup {
  id?: number | string
  code?: string
  customer_code?: string
  customerCode?: string
}

interface EligibleProjectPage {
  items?: Array<Record<string, unknown>>
  total?: number
  filters?: Record<string, unknown>
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

async function loadContract(event: H3Event, id: string) {
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'contract', 'view')
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<ContractForProjectLookup>>(
    event,
    `/v1/altoc/contracts/${encodeURIComponent(id)}`,
    {
      appCode: 'altoc',
      scope: 'altoc.read altoc:contract:view',
      method: 'GET',
      query: dataAccessQuery
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for contract project lookup.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  const contract = runtime.data.data
  if (!contract?.code) {
    throw createError({ statusCode: 404, message: 'Contract not found.' })
  }
  return contract
}

function resolveAimsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'aims')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Aims service API base URL is not configured.' })
  }
  return baseUrl
}

export default defineEventHandler(async (event) => {
  const id = text(getRouterParam(event, 'id'))
  if (!id) {
    throw createError({ statusCode: 400, message: 'Contract id is required.' })
  }

  await requirePermission(event, 'contract', 'view')
  const contract = await loadContract(event, id)
  const query = getQuery(event)
  const params = new URLSearchParams()
  params.set('contract_code', text(contract.code))
  const customerCode = text(contract.customer_code || contract.customerCode)
  if (customerCode) params.set('customer_code', customerCode)
  for (const key of ['search', 'project_code', 'limit', 'include_linked']) {
    const value = text(query[key])
    if (value) params.set(key, value)
  }

  const token = await requestServiceAccessToken({
    audience: 'aims',
    scope: 'aims:read',
    event
  })
  const response = await $fetch<RuntimeEnvelope<EligibleProjectPage>>(
    `${appendPath(resolveAimsBaseUrl(event), '/api/v1/service/projects/eligible-for-contract')}?${params.toString()}`,
    {
      headers: {
        ...forwardedContextHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Aims service API returned an error.' })
  }

  return {
    code: 0,
    data: response.data || { items: [], total: 0 }
  }
})
