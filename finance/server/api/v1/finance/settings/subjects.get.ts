import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_subject',
  select: ['id', 'code', 'name', 'subject_type', 'parent_id', 'sort_no', 'status', 'remark', 'created_at'],
  searchColumns: ['code', 'name', 'subject_type'],
  statusColumn: 'status',
  defaultOrderBy: 'status ASC, sort_no ASC, id ASC'
}))
