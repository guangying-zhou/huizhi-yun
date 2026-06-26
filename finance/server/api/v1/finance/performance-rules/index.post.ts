import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { cleanString, generateFinanceCode, jsonOrNull, optionalDate, requiredString, type SqlParam } from '../../../../utils/financeWrite'
import type { FinanceRow } from '../../../../types/finance'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('PR')
  const name = requiredString(body.name, 'name')

  await execute(`
    INSERT INTO performance_rule (
      code,
      name,
      rule_type,
      scope_type,
      scope_code,
      effective_from,
      effective_to,
      rule_json,
      status,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `, [
    code,
    name,
    cleanString(body.ruleType ?? body.rule_type) || 'commission',
    cleanString(body.scopeType ?? body.scope_type) || 'company',
    cleanString(body.scopeCode ?? body.scope_code),
    optionalDate(body.effectiveFrom ?? body.effective_from),
    optionalDate(body.effectiveTo ?? body.effective_to),
    jsonOrNull(body.ruleJson ?? body.rule_json) || '{}',
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by ?? body.createdBy ?? body.created_by)
  ] satisfies SqlParam[])

  const data = await queryRow<FinanceRow>('SELECT * FROM performance_rule WHERE code = ?', [code])
  return { data }
})
