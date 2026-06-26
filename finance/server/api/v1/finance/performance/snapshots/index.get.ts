import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../../utils/financeList'
import type { FinanceRow } from '../../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'performance_calculation_snapshot',
  select: [
    'id',
    'code',
    'period_month',
    'calculation_type',
    'target_type',
    'target_code',
    'rule_id',
    'calculated_by',
    'calculated_at'
  ],
  searchColumns: ['code', 'period_month', 'calculation_type', 'target_type', 'target_code'],
  defaultOrderBy: 'calculated_at DESC, id DESC'
}))
