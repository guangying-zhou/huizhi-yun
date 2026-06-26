import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { cleanString, generateFinanceCode, jsonOrNull, moneyString, numberOrNull, requiredString, type SqlParam } from '../../../../utils/financeWrite'
import { periodMonth } from '../../../../utils/financeCalculation'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('EFC')
  const employeeUid = requiredString(body.employeeUid ?? body.employee_uid, 'employeeUid')
  const month = periodMonth(body.periodMonth ?? body.period_month)

  await execute(`
    INSERT INTO employee_finance_contribution (
      code,
      employee_uid,
      employee_name,
      dept_code,
      project_code,
      contract_code,
      period_month,
      contribution_type,
      contribution_amount,
      contribution_ratio,
      source_type,
      source_refs_json,
      status,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `, [
    code,
    employeeUid,
    cleanString(body.employeeName ?? body.employee_name),
    cleanString(body.deptCode ?? body.dept_code),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.contractCode ?? body.contract_code),
    month,
    cleanString(body.contributionType ?? body.contribution_type) || 'other',
    moneyString(body.contributionAmount ?? body.contribution_amount, 'contributionAmount'),
    numberOrNull(body.contributionRatio ?? body.contribution_ratio, 'contributionRatio'),
    cleanString(body.sourceType ?? body.source_type) || 'manual',
    jsonOrNull(body.sourceRefs ?? body.source_refs_json),
    cleanString(body.createdBy ?? body.created_by)
  ] satisfies SqlParam[])

  const data = await queryRow<FinanceRow>('SELECT * FROM employee_finance_contribution WHERE code = ?', [code])
  return { data }
})
