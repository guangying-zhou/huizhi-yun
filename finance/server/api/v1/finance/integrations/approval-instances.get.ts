import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'external_approval_instance',
  select: [
    'id',
    'biz_type',
    'biz_code',
    'workflow_instance_id',
    'external_platform',
    'external_instance_id',
    'status',
    'submitted_by',
    'submitted_at',
    'completed_at',
    'last_synced_at',
    'error_message',
    'created_at'
  ],
  searchColumns: ['biz_type', 'biz_code', 'workflow_instance_id', 'external_platform', 'external_instance_id', 'submitted_by'],
  statusColumn: 'status',
  defaultOrderBy: 'updated_at DESC, id DESC'
}))
