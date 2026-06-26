import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_subject_mapping',
  select: [
    'id',
    'biz_type',
    'biz_subtype',
    'income_type_code',
    'expense_type_code',
    'default_subject_code',
    'object_strategy',
    'required_dimensions_json',
    'sort_no',
    'status',
    'remark',
    'created_at'
  ],
  searchColumns: ['biz_type', 'biz_subtype', 'income_type_code', 'expense_type_code', 'default_subject_code', 'object_strategy'],
  statusColumn: 'status',
  defaultOrderBy: 'sort_no ASC, id ASC'
}))
