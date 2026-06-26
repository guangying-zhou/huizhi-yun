import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'invoice_request',
  select: [
    'id',
    'code',
    'source_app',
    'customer_code',
    'customer_name',
    'contract_code',
    'receivable_plan_code',
    'invoice_type',
    'invoice_item',
    'requested_amount',
    'status',
    'workflow_instance_id',
    'requested_by',
    'created_at',
    'deleted_at'
  ],
  searchColumns: ['code', 'customer_name', 'contract_code', 'receivable_plan_code', 'invoice_item'],
  statusColumn: 'status',
  defaultOrderBy: 'created_at DESC, id DESC'
}))
