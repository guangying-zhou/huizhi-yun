import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'project_finance_summary',
  select: [
    'id',
    'project_code',
    'project_name',
    'customer_code',
    'contract_code',
    'period_month',
    'contract_amount',
    'invoice_amount',
    'received_amount',
    'direct_expense_amount',
    'labor_cost_amount',
    'allocated_cost_amount',
    'gross_profit_amount',
    'gross_margin_rate',
    'calculated_at',
    'created_at'
  ],
  searchColumns: ['project_code', 'project_name', 'customer_code', 'contract_code', 'period_month'],
  defaultOrderBy: 'period_month DESC, project_code ASC'
}))
