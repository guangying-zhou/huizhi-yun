import { createError, getHeader, readBody, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallFinanceDataRuntime } from '../../../../utils/dataRuntime'

interface RuntimeEnvelope<T> {
  data?: T
  code?: number
  message?: string
}

type ReconciliationData = Record<string, unknown>

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

function objectValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return {}
}

function syncErrorPayload(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const statusCode = Number(source.statusCode || source.status || 0)
  return {
    statusCode: Number.isFinite(statusCode) && statusCode > 0 ? statusCode : 500,
    message: error instanceof Error ? error.message : text(source.message || 'Altoc finance summary sync failed.')
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

async function syncAltocFinanceSummary(event: H3Event, reconciliation: ReconciliationData, requestBody: Record<string, unknown>) {
  const contractSummary = objectValue(reconciliation, 'contractSummary', 'contract_summary')
  const receivablePlanSummary = objectValue(reconciliation, 'receivablePlanSummary', 'receivable_plan_summary')
  const contractCode = [
    reconciliation.contractCode,
    reconciliation.contract_code,
    contractSummary.contractCode,
    contractSummary.contract_code,
    requestBody.contractCode,
    requestBody.contract_code
  ].map(text).find(Boolean) || ''
  if (!contractCode) return null

  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Altoc service API base URL is not configured.' })
  }

  const reconciliationCode = text(reconciliation.code || requestBody.code)
  const calculatedAt = text(contractSummary.calculatedAt || contractSummary.calculated_at)
  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || (reconciliationCode
      ? `finance:reconciliation:${reconciliationCode}:altoc-summary:v1`
      : `finance:contract:${contractCode}:summary:${calculatedAt || 'latest'}`)
  const token = await requestServiceAccessToken({
    audience: 'altoc',
    scope: 'altoc:write altoc:contract:finance-summary:sync',
    event
  })

  const response = await $fetch<RuntimeEnvelope<Record<string, unknown>>>(
    appendPath(baseUrl, `/api/v1/service/contracts/${encodeURIComponent(contractCode)}/finance-summary:sync`),
    {
      method: 'POST',
      headers: {
        ...forwardedContextHeaders(event, idempotencyKey),
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: {
        contractSummary,
        contract_summary: contractSummary,
        receivablePlanSummary,
        receivable_plan_summary: receivablePlanSummary,
        reconciliation,
        sourceReconciliation: reconciliation,
        source_reconciliation: reconciliation,
        idempotencyKey
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Altoc service API returned an error.' })
  }
  return response.data || null
}

export default defineEventHandler(async (event) => {
  const body = objectBody(await readBody(event).catch(() => ({})))
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<ReconciliationData>>(
    event,
    '/v1/finance/reconciliation',
    {
      scope: 'finance.write',
      method: 'POST',
      body
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Finance tenant-runtime is required for /api/v1/finance/reconciliation.'
    })
  }

  const data = runtime.data.data || {}
  let altocSync: Record<string, unknown> | null = null
  let altocSyncError: ReturnType<typeof syncErrorPayload> | null = null
  try {
    altocSync = await syncAltocFinanceSummary(event, data, body)
  } catch (error) {
    altocSyncError = syncErrorPayload(error)
  }
  return {
    ...runtime.data,
    data: {
      ...data,
      altocFinanceSummarySync: altocSync,
      ...(altocSyncError ? { altocFinanceSummarySyncError: altocSyncError } : {})
    }
  }
})
