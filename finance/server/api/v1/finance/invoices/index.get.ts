import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_invoice',
  select: [
    'id',
    'code',
    'invoice_no',
    'customer_code',
    'customer_name',
    'contract_code',
    'project_code',
    'invoice_type',
    'invoice_medium',
    'invoice_item',
    'invoice_amount',
    'tax_amount',
    'invoice_date',
    'status',
    'invoice_file_url',
    'invoice_file_name',
    'invoice_file_mime_type',
    'invoice_file_size',
    'created_at',
    'deleted_at'
  ],
  searchColumns: ['code', 'invoice_no', 'customer_name', 'contract_code', 'project_code'],
  dateColumn: 'invoice_date',
  statusColumn: 'status',
  defaultOrderBy: 'COALESCE(invoice_date, created_at) DESC, id DESC'
}))
