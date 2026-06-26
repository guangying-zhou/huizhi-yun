import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'
import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery
} from '../../../../utils/dataRuntime'

export default defineEventHandler(async (event) => {
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/employee-costs', 'GET')
  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery)

  return listFinanceRows<FinanceRow>(event, {
    table: 'employee_cost_snapshot',
    select: [
      'id',
      'employee_uid',
      'employee_name',
      'dept_code',
      'position_code',
      'rank_code',
      'period_month',
      'standard_cost_amount',
      'actual_cost_amount',
      'cost_source',
      'created_at'
    ],
    searchColumns: ['employee_uid', 'employee_name', 'dept_code', 'position_code', 'rank_code', 'period_month'],
    defaultOrderBy: 'period_month DESC, employee_uid ASC'
  })
})
