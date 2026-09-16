import { createError, defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { getRequestUid } from '../../../../../utils/authIdentity'
import { requirePermission } from '../../../../../utils/checkPermission'
import {
  buildFinanceRuntimeAuthBody,
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from '../../../../../utils/dataRuntime'
import { tryDispatchAltocFinanceSummaryOperation } from '../../../../../utils/altocFinanceSummaryOperation'

interface RuntimeEnvelope<T> {
  data?: T
  code?: number
  message?: string
}

type ReconciliationData = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

export default defineEventHandler(async (event) => {
  const code = text(getRouterParam(event, 'code'))
  if (!code) {
    throw createError({ statusCode: 400, message: 'invoice code is required' })
  }

  await requirePermission(event, 'invoices', 'view')
  await requirePermission(event, 'receipts', 'confirm')
  await requirePermission(event, 'reconciliation', 'confirm')

  const body = objectBody(await readBody(event).catch(() => ({})))
  const operator = getRequestUid(event) || 'finance-ui'
  const runtimePath = `/v1/finance/invoices/${encodeURIComponent(code)}/receipt-reconcile`
  const authQuery = await buildFinanceRuntimeAuthQuery(event, runtimePath, 'POST', {})
  const runtimeBody = buildFinanceRuntimeAuthBody(runtimePath, 'POST', {
    ...body,
    createdBy: text(body.createdBy || body.created_by) || operator,
    updatedBy: text(body.updatedBy || body.updated_by) || operator,
    confirmedBy: text(body.confirmedBy || body.confirmed_by) || operator
  }, authQuery)

  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<ReconciliationData>>(
    event,
    runtimePath,
    {
      scope: 'finance.write',
      method: 'POST',
      query: authQuery,
      body: runtimeBody
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Finance tenant-runtime is required for invoice receipt reconciliation.'
    })
  }

  const data = runtime.data.data || {}
  const operation = objectBody(data.altocFinanceSummaryOperation)
  const operationKey = text(operation.operationKey)
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
