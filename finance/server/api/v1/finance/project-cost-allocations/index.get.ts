import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'project_cost_allocation',
  select: [
    'id',
    'code',
    'project_code',
    'period_month',
    'allocation_type',
    'employee_uid',
    'amount',
    'allocation_basis',
    'basis_value',
    'rule_code',
    'status',
    'created_at'
  ],
  searchColumns: ['code', 'project_code', 'period_month', 'allocation_type', 'employee_uid', 'rule_code'],
  statusColumn: 'status',
  defaultOrderBy: 'period_month DESC, project_code ASC, id DESC'
}))
