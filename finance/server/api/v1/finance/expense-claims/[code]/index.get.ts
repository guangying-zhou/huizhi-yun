import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, getRouterParam } from 'h3'
import { getFinanceRecord } from '../../../../../utils/financeRecord'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<{ data: RowDataPacket }>(event)
  if (runtime.handled) return runtime.data

  const code = String(getRouterParam(event, 'code') || '').trim()
  const row = await getFinanceRecord<RowDataPacket>(code, {
    table: 'expense_claim',
    notFoundMessage: 'expense claim not found'
  })
  return { data: row }
})
