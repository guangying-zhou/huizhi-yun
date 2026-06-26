import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'employee_finance_contribution',
  select: [
    'id',
    'code',
    'employee_uid',
    'employee_name',
    'dept_code',
    'project_code',
    'contract_code',
    'period_month',
    'contribution_type',
    'contribution_amount',
    'contribution_ratio',
    'source_type',
    'status',
    'created_at'
  ],
  searchColumns: ['code', 'employee_uid', 'employee_name', 'dept_code', 'project_code', 'contract_code', 'period_month', 'contribution_type'],
  statusColumn: 'status',
  defaultOrderBy: 'period_month DESC, employee_uid ASC, id DESC'
}))
