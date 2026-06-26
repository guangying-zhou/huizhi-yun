import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { approvalTargets, submitApproval } from '../../../../../utils/financeApproval'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  const body = await readBody<Record<string, unknown>>(event)
  const data = await submitApproval(approvalTargets.invoice_request, code, body, event)
  return { data }
})
