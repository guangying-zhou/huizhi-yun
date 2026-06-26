import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { assertAllowed, cleanString, jsonOrNull, numberOrNull, requiredString, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)

  await execute(`
    INSERT INTO finance_subject_mapping (
      biz_type,
      biz_subtype,
      income_type_code,
      expense_type_code,
      default_subject_code,
      object_strategy,
      required_dimensions_json,
      status,
      sort_no,
      remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    requiredString(body.bizType ?? body.biz_type, 'bizType'),
    cleanString(body.bizSubtype ?? body.biz_subtype) || '',
    cleanString(body.incomeTypeCode ?? body.income_type_code) || '',
    cleanString(body.expenseTypeCode ?? body.expense_type_code) || '',
    requiredString(body.defaultSubjectCode ?? body.default_subject_code, 'defaultSubjectCode'),
    requiredString(body.objectStrategy ?? body.object_strategy, 'objectStrategy'),
    jsonOrNull(body.requiredDimensions ?? body.required_dimensions_json),
    assertAllowed(cleanString(body.status) || 'active', 'status', ['active', 'inactive']),
    numberOrNull(body.sortNo ?? body.sort_no, 'sortNo') || 0,
    cleanString(body.remark)
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>(`
    SELECT *
    FROM finance_subject_mapping
    WHERE biz_type = ?
      AND biz_subtype = ?
      AND income_type_code = ?
      AND expense_type_code = ?
    LIMIT 1
  `, [
    requiredString(body.bizType ?? body.biz_type, 'bizType'),
    cleanString(body.bizSubtype ?? body.biz_subtype) || '',
    cleanString(body.incomeTypeCode ?? body.income_type_code) || '',
    cleanString(body.expenseTypeCode ?? body.expense_type_code) || ''
  ])
  return { data }
})
