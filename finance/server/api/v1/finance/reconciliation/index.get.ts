import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_reconciliation',
  select: [
    'id',
    'code',
    'receipt_id',
    'invoice_id',
    'customer_code',
    'contract_code',
    'project_code',
    'receivable_plan_code',
    'reconciled_amount',
    'reconciled_at',
    'reconciliation_type',
    'status',
    'created_at'
  ],
  searchColumns: ['code', 'customer_code', 'contract_code', 'project_code', 'receivable_plan_code'],
  dateColumn: 'reconciled_at',
  statusColumn: 'status',
  defaultOrderBy: 'reconciled_at DESC, id DESC'
}))
