import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery,
  maybeCallCurrentFinanceDataRuntime
} from '../../../../utils/dataRuntime'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { cleanString, jsonOrNull, moneyString, requiredString, type SqlParam } from '../../../../utils/financeWrite'
import { periodMonth } from '../../../../utils/financeCalculation'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/employee-costs', 'POST')
  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery)

  const body = await readBody<Record<string, unknown>>(event)
  const employeeUid = requiredString(body.employeeUid ?? body.employee_uid, 'employeeUid')
  const month = periodMonth(body.periodMonth ?? body.period_month)

  await execute(`
    INSERT INTO employee_cost_snapshot (
      employee_uid,
      employee_name,
      dept_code,
      position_code,
      rank_code,
      period_month,
      standard_cost_amount,
      actual_cost_amount,
      cost_source,
      source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      employee_name = VALUES(employee_name),
      dept_code = VALUES(dept_code),
      position_code = VALUES(position_code),
      rank_code = VALUES(rank_code),
      standard_cost_amount = VALUES(standard_cost_amount),
      actual_cost_amount = VALUES(actual_cost_amount),
      cost_source = VALUES(cost_source),
      source_refs_json = VALUES(source_refs_json)
  `, [
    employeeUid,
    cleanString(body.employeeName ?? body.employee_name),
    cleanString(body.deptCode ?? body.dept_code),
    cleanString(body.positionCode ?? body.position_code),
    cleanString(body.rankCode ?? body.rank_code),
    month,
    moneyString(body.standardCostAmount ?? body.standard_cost_amount, 'standardCostAmount'),
    moneyString(body.actualCostAmount ?? body.actual_cost_amount, 'actualCostAmount'),
    cleanString(body.costSource ?? body.cost_source) || 'manual',
    jsonOrNull(body.sourceRefs ?? body.source_refs_json)
  ] satisfies SqlParam[])

  const data = await queryRow<FinanceRow>(
    'SELECT * FROM employee_cost_snapshot WHERE employee_uid = ? AND period_month = ?',
    [employeeUid, month]
  )
  return { data }
})
