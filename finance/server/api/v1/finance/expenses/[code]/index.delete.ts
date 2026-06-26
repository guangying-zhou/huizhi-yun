import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import { defineEventHandler, getRouterParam } from 'h3'
import { softDeleteFinanceRecord } from '../../../../../utils/financeRecord'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  const data = await softDeleteFinanceRecord(code, {
    table: 'finance_expense',
    notFoundMessage: 'expense not found'
  })
  return { data }
})
