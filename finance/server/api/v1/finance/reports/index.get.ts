import { defineEventHandler } from 'h3'
import { monthlyFinanceReport } from '../../../../utils/financeReports'
import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery,
  maybeCallCurrentFinanceDataRuntime
} from '../../../../utils/dataRuntime'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<Awaited<ReturnType<typeof monthlyFinanceReport>>>(event)
  if (runtime.handled) return runtime.data
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/reports', 'GET')
  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery)
  return monthlyFinanceReport(event)
})
