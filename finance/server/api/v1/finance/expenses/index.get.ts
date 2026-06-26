import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_expense',
  select: [
    'id',
    'code',
    'expense_date',
    'expense_amount',
    'fee_amount',
    'currency_code',
    'project_code',
    'contract_code',
    'customer_code',
    'department_code',
    'accounting_object_type',
    'accounting_object_code',
    'sales_scope_type',
    'sales_scope_code',
    'sales_region_code',
    'sales_owner_uid',
    'handler_user_id',
    'payee_name',
    'payment_channel',
    'source_request_type',
    'source_request_code',
    'status',
    'description',
    'created_at',
    'deleted_at'
  ],
  searchColumns: ['code', 'project_code', 'contract_code', 'customer_code', 'department_code', 'accounting_object_code', 'sales_scope_code', 'sales_region_code', 'sales_owner_uid', 'handler_user_id', 'payee_name', 'description'],
  dateColumn: 'expense_date',
  statusColumn: 'status',
  defaultOrderBy: 'expense_date DESC, id DESC'
}))
