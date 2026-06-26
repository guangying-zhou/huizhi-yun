import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { assertAllowed, cleanString, numberOrNull, requiredString, toDbBoolean, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = requiredString(body.code, 'code')

  await execute(`
    INSERT INTO finance_income_type (
      code,
      name,
      default_subject_id,
      is_contract_income,
      status,
      sort_no,
      remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    requiredString(body.name, 'name'),
    numberOrNull(body.defaultSubjectId ?? body.default_subject_id, 'defaultSubjectId'),
    toDbBoolean(body.isContractIncome ?? body.is_contract_income, true),
    assertAllowed(cleanString(body.status) || 'active', 'status', ['active', 'inactive']),
    numberOrNull(body.sortNo ?? body.sort_no, 'sortNo') || 0,
    cleanString(body.remark)
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM finance_income_type WHERE code = ?', [code])
  return { data }
})
