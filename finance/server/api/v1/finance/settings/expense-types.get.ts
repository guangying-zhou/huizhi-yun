import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_expense_type',
  select: ['id', 'code', 'name', 'default_subject_id', 'cost_category', 'reimbursable', 'sort_no', 'status', 'created_at'],
  searchColumns: ['code', 'name', 'cost_category'],
  statusColumn: 'status',
  defaultOrderBy: 'sort_no ASC, id ASC'
}))
