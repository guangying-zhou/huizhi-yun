import { createError, readBody, setResponseStatus } from 'h3'
import { maybeCallFinanceDataRuntime } from '../../../../utils/dataRuntime'
import { tryDispatchAltocFinanceSummaryOperation } from '../../../../utils/altocFinanceSummaryOperation'

type ReconciliationData = Record<string, unknown>

interface RuntimeEnvelope<T> {
  data?: T
  code?: number
  message?: string
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
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
  const operation = objectBody(data.altocFinanceSummaryOperation)
  const operationKey = String(operation.operationKey || '').trim()
  const altocSync = operationKey
    ? await tryDispatchAltocFinanceSummaryOperation(event, operationKey)
    : { synced: false, pending: false, linked: false }
  if (altocSync.pending) setResponseStatus(event, 202)
  return {
    ...runtime.data,
    data: {
      ...data,
      altocFinanceSummarySync: altocSync
    }
  }
})
