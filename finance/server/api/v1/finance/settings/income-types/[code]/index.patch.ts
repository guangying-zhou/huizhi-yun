import { maybeCallCurrentFinanceDataRuntime } from '../../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../../utils/db'
import { assertAllowed, cleanString, numberOrNull, toDbBoolean, type SqlParam } from '../../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const hasIsContractIncome = body.isContractIncome !== undefined || body.is_contract_income !== undefined

  await execute(`
    UPDATE finance_income_type
    SET
      name = COALESCE(?, name),
      default_subject_id = COALESCE(?, default_subject_id),
      is_contract_income = COALESCE(?, is_contract_income),
      status = COALESCE(?, status),
      sort_no = COALESCE(?, sort_no),
      remark = COALESCE(?, remark),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ?
  `, [
    cleanString(body.name),
    numberOrNull(body.defaultSubjectId ?? body.default_subject_id, 'defaultSubjectId'),
    hasIsContractIncome ? toDbBoolean(body.isContractIncome ?? body.is_contract_income, true) : null,
    assertAllowed(cleanString(body.status), 'status', ['active', 'inactive']),
    numberOrNull(body.sortNo ?? body.sort_no, 'sortNo'),
    cleanString(body.remark),
    code
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM finance_income_type WHERE code = ?', [code])
  if (!data) throw createError({ statusCode: 404, statusMessage: 'income type not found' })
  return { data }
})
