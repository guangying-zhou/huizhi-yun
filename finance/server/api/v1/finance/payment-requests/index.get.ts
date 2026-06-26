import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'payment_request',
  select: [
    'id',
    'code',
    'title',
    'payment_type',
    'applicant_user_id',
    'applicant_dept_code',
    'project_code',
    'contract_code',
    'customer_code',
    'supplier_code',
    'payee_name',
    'requested_amount',
    'approved_amount',
    'paid_amount',
    'planned_pay_date',
    'status',
    'workflow_instance_id',
    'created_at',
    'deleted_at'
  ],
  searchColumns: ['code', 'title', 'applicant_user_id', 'project_code', 'contract_code', 'customer_code', 'supplier_code', 'payee_name'],
  dateColumn: 'planned_pay_date',
  statusColumn: 'status',
  defaultOrderBy: 'created_at DESC, id DESC'
}))
