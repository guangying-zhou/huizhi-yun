import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_receipt',
  select: [
    'id',
    'code',
    'receipt_no',
    'customer_code',
    'customer_name',
    'contract_code',
    'project_code',
    'receivable_plan_code',
    'receipt_source_type',
    'accounting_object_type',
    'accounting_object_code',
    'received_amount',
    'reconciled_amount',
    'unreconciled_amount',
    'received_at',
    'channel',
    'payer_name',
    'status',
    'created_at',
    'deleted_at'
  ],
  searchColumns: ['code', 'receipt_no', 'customer_name', 'contract_code', 'project_code', 'accounting_object_code', 'payer_name'],
  dateColumn: 'received_at',
  statusColumn: 'status',
  defaultOrderBy: 'received_at DESC, id DESC'
}))
