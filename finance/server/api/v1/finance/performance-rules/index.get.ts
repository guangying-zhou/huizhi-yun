import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'performance_rule',
  select: [
    'id',
    'code',
    'name',
    'rule_type',
    'scope_type',
    'scope_code',
    'effective_from',
    'effective_to',
    'status',
    'created_at'
  ],
  searchColumns: ['code', 'name', 'rule_type', 'scope_type', 'scope_code'],
  statusColumn: 'status',
  defaultOrderBy: 'status ASC, id DESC'
}))
