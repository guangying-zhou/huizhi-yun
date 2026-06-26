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

type RuntimeRow = Record<string, unknown>

interface MaintenanceSummary {
  maintenanceContracts?: RuntimeRow[]
  maintenance_contracts?: RuntimeRow[]
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

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

async function fetchMaintenanceSummary(event: H3Event, customerCode: string, query: Record<string, unknown>) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<MaintenanceSummary>>(
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
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for maintenance scope.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data || {}
}

function contractRows(summary: MaintenanceSummary) {
  return summary.maintenanceContracts || summary.maintenance_contracts || []
}

export default defineEventHandler(async (event) => {
  const customerCode = text(getRouterParam(event, 'customerCode'))
  if (!customerCode) {
    throw createError({ statusCode: 400, message: 'customerCode is required.' })
  }

  await requirePermission(event, 'customer', 'view')

  const baseUrl = resolveServiceAppBaseUrl(event, 'finance')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Finance service API base URL is not configured.' })
  }

  const query = getQuery(event)
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'customer', 'view')
  const maintenanceSummary = await fetchMaintenanceSummary(event, customerCode, dataAccessQuery)
  const contracts = contractRows(maintenanceSummary)
  const contractCodes = unique([
    ...contracts.map(row => text(row.contract_code || row.contractCode)),
    ...text(query.contract_codes || query.contractCodes || query.contract_code).split(',')
  ])
  const projectCodes = unique([
    ...contracts.map(row => text(row.project_code || row.projectCode)),
    ...text(query.project_codes || query.projectCodes || query.project_code).split(',')
  ])

  const params = new URLSearchParams()
  if (contractCodes.length > 0) params.set('contract_codes', contractCodes.join(','))
  if (projectCodes.length > 0) params.set('project_codes', projectCodes.join(','))
  const periodMonth = text(query.period_month || query.periodMonth)
  if (periodMonth) params.set('period_month', periodMonth)

  const emptyData = {
    summary: {},
    items: [],
    maintenanceScope: {
      contractCodes,
      projectCodes
    }
  }
  if (contractCodes.length === 0 && projectCodes.length === 0) {
    return {
      code: 0,
      message: 'ok',
      data: emptyData
    }
  }

  const token = await requestServiceAccessToken({
    audience: 'finance',
    scope: 'finance:read',
    event
  })
  const queryString = params.toString()
  let response: RuntimeEnvelope<unknown>
  try {
    response = await $fetch<RuntimeEnvelope<unknown>>(
      `${appendPath(baseUrl, `/api/v1/finance/service/customers/${encodeURIComponent(customerCode)}/maintenance-financial-summary`)}${queryString ? `?${queryString}` : ''}`,
      {
        headers: {
          ...forwardedContextHeaders(event),
          authorization: `Bearer ${token}`
        },
        timeout: 10000
      }
    )
  } catch (error: unknown) {
    if (httpStatus(error) === 404) {
      return {
        code: 0,
        message: 'ok',
        data: {
          ...emptyData,
          warning: 'finance_maintenance_summary_not_found'
        }
      }
    }
    throw error
  }

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Finance service API returned an error.' })
  }

  return {
    code: 0,
    message: 'ok',
    data: {
      ...(response.data && typeof response.data === 'object' ? response.data as RuntimeRow : { financeSummary: response.data ?? response }),
      maintenanceScope: {
        contractCodes,
        projectCodes
      }
    }
  }
})
