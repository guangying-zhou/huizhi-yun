import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { cleanString, generateFinanceCode, moneyString, numberOrNull, requiredString, type SqlParam } from '../../../../utils/financeWrite'
import { periodMonth } from '../../../../utils/financeCalculation'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('PCA')
  const projectCode = requiredString(body.projectCode ?? body.project_code, 'projectCode')
  const month = periodMonth(body.periodMonth ?? body.period_month)
  const amount = moneyString(body.amount, 'amount', { required: true })

  await execute(`
    INSERT INTO project_cost_allocation (
      code,
      project_code,
      period_month,
      allocation_type,
      source_table,
      source_id,
      employee_uid,
      amount,
      allocation_basis,
      basis_value,
      rule_code,
      status,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `, [
    code,
    projectCode,
    month,
    cleanString(body.allocationType ?? body.allocation_type) || 'other',
    cleanString(body.sourceTable ?? body.source_table),
    numberOrNull(body.sourceId ?? body.source_id, 'sourceId'),
    cleanString(body.employeeUid ?? body.employee_uid),
    amount,
    cleanString(body.allocationBasis ?? body.allocation_basis),
    numberOrNull(body.basisValue ?? body.basis_value, 'basisValue'),
    cleanString(body.ruleCode ?? body.rule_code),
    cleanString(body.createdBy ?? body.created_by)
  ] satisfies SqlParam[])

  const data = await queryRow<FinanceRow>('SELECT * FROM project_cost_allocation WHERE code = ?', [code])
  return { data }
})
