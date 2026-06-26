import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_audit_log',
  select: [
    'id',
    'entity_type',
    'entity_id',
    'entity_code',
    'action',
    'operator_id',
    'operator_ip',
    'source_app',
    'request_id',
    'created_at'
  ],
  searchColumns: ['entity_type', 'entity_code', 'action', 'operator_id', 'request_id'],
  defaultOrderBy: 'created_at DESC, id DESC'
}))
