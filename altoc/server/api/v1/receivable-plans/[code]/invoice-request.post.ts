import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface PreparedInvoiceRequest {
  receivablePlan?: Record<string, unknown>
  invoiceRequest?: Record<string, unknown>
  idempotencyKey?: string
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

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function serviceErrorPayload(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const statusCode = Number(source.statusCode || source.status || 0)
  return {
    statusCode: Number.isFinite(statusCode) && statusCode > 0 ? statusCode : 500,
    message: error instanceof Error ? error.message : text(source.message || 'Service call failed.')
  }
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

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:receivable:edit',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for this operation.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

function resolveFinanceBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'finance')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Finance service API base URL is not configured.' })
  }
  return baseUrl
}

async function callFinanceService<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  const token = await requestServiceAccessToken({
    audience: 'finance',
    scope: 'finance:write',
    event
  })
  const response = await $fetch<RuntimeEnvelope<T>>(appendPath(resolveFinanceBaseUrl(event), path), {
    method: 'POST',
    headers: {
      ...forwardedContextHeaders(event, idempotencyKey),
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body,
    timeout: 10000
  })

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Finance service API returned an error.' })
  }
  return response.data as T
}

function canSubmitInvoiceRequest(invoiceRequest: Record<string, unknown>, submitRequested: boolean) {
  if (!submitRequested) return false
  const code = text(invoiceRequest.code)
  if (!code) return false
  const status = text(invoiceRequest.status) || 'draft'
  return status === 'draft' || status === 'rejected'
}

export default defineEventHandler(async (event) => {
  const receivablePlanCode = text(getRouterParam(event, 'code'))
  if (!receivablePlanCode) {
    throw createError({ statusCode: 400, message: 'receivablePlanCode is required' })
  }

  await requirePermission(event, 'receivable', 'edit')
  const actorUid = getRequestUid(event)
  const body = objectBody(await readBody(event).catch(() => ({})))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'receivable', 'edit')
  const baseKey = text(getHeader(event, 'idempotency-key'))
    || `altoc:receivable:${receivablePlanCode}:invoice-request:v1`
  const operationBody = {
    ...body,
    operatorUid: body.operatorUid || body.operator_uid || actorUid,
    current_user: body.current_user || actorUid,
    idempotencyKey: baseKey
  }

  const prepared = await callAltocRuntime<PreparedInvoiceRequest>(
    event,
    `/v1/altoc/service/receivable-plans/${encodeURIComponent(receivablePlanCode)}/invoice-request:prepare`,
    operationBody,
    dataAccessQuery
  )
  const invoiceRequestPayload = prepared.invoiceRequest || {}
  const invoiceRequest = await callFinanceService<Record<string, unknown>>(
    event,
    '/api/v1/finance/invoice-requests',
    invoiceRequestPayload,
    baseKey
  )

  let financeSubmit: Record<string, unknown> | null = null
  let financeSubmitError: ReturnType<typeof serviceErrorPayload> | null = null
  const submitRequested = body.submit !== false
  if (canSubmitInvoiceRequest(invoiceRequest, submitRequested)) {
    const submitKey = `${baseKey}:submit:v1`
    try {
      financeSubmit = await callFinanceService<Record<string, unknown>>(
        event,
        `/api/v1/finance/invoice-requests/${encodeURIComponent(text(invoiceRequest.code))}/submit`,
        {
          submittedBy: actorUid,
          submitted_by: actorUid,
          idempotencyKey: submitKey
        },
        submitKey
      )
    } catch (error) {
      financeSubmitError = serviceErrorPayload(error)
    }
  }

  const auditRecord = await callAltocRuntime<Record<string, unknown>>(
    event,
    `/v1/altoc/service/receivable-plans/${encodeURIComponent(receivablePlanCode)}/invoice-request:record`,
    {
      operatorUid: actorUid,
      current_user: actorUid,
      idempotencyKey: baseKey,
      invoiceRequest,
      financeSubmit,
      financeSubmitError
    },
    dataAccessQuery
  )

  return {
    code: 0,
    message: 'ok',
    data: {
      receivablePlan: prepared.receivablePlan,
      invoiceRequest,
      financeSubmit,
      ...(financeSubmitError ? { financeSubmitError } : {}),
      auditRecord,
      idempotencyKey: baseKey
    }
  }
})
