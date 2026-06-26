import { defineEventHandler } from 'h3'
import { listFinanceRows } from '../../../../utils/financeList'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(event => listFinanceRows<FinanceRow>(event, {
  table: 'finance_accounting_object',
  select: [
    'id',
    'code',
    'name',
    'object_type',
    'source_app',
    'source_code',
    'customer_code',
    'contract_code',
    'project_code',
    'department_code',
    'sales_region_code',
    'owner_uid',
    'status',
    'remark',
    'created_at'
  ],
  searchColumns: ['code', 'name', 'object_type', 'customer_code', 'contract_code', 'project_code', 'department_code', 'sales_region_code', 'owner_uid'],
  statusColumn: 'status',
  defaultOrderBy: 'object_type ASC, name ASC, id ASC'
}))
