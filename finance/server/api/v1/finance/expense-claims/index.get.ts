import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'expense_claim',
  select: [
    'id',
    'code',
    'title',
    'applicant_user_id',
    'applicant_dept_code',
    'project_code',
    'contract_code',
    'customer_code',
    'total_amount',
    'approved_amount',
    'paid_amount',
    'status',
    'workflow_instance_id',
    'submitted_at',
    'created_at',
    'deleted_at'
  ],
  searchColumns: ['code', 'title', 'applicant_user_id', 'project_code', 'contract_code', 'customer_code'],
  statusColumn: 'status',
  defaultOrderBy: 'created_at DESC, id DESC'
}))
