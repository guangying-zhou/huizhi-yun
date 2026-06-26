import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'employee_finance_performance',
  select: [
    'id',
    'code',
    'employee_uid',
    'employee_name',
    'dept_code',
    'period_month',
    'performance_type',
    'base_amount',
    'performance_amount',
    'performance_score',
    'status',
    'calculated_at',
    'created_at'
  ],
  searchColumns: ['code', 'employee_uid', 'employee_name', 'dept_code', 'period_month', 'performance_type'],
  statusColumn: 'status',
  defaultOrderBy: 'period_month DESC, employee_uid ASC'
}))
