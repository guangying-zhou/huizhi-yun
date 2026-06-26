import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_income_type',
  select: ['id', 'code', 'name', 'default_subject_id', 'is_contract_income', 'sort_no', 'status', 'remark', 'created_at'],
  searchColumns: ['code', 'name'],
  statusColumn: 'status',
  defaultOrderBy: 'sort_no ASC, id ASC'
}))
