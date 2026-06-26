import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { FINANCE_SUBJECT_TYPES, assertAllowed, cleanString, numberOrNull, requiredString, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = requiredString(body.code, 'code')
  const subjectType = assertAllowed(
    requiredString(body.subjectType ?? body.subject_type, 'subjectType'),
    'subjectType',
    [...FINANCE_SUBJECT_TYPES]
  )

  await execute(`
    INSERT INTO finance_subject (
      code,
      name,
      subject_type,
      parent_id,
      sort_no,
      status,
      remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    requiredString(body.name, 'name'),
    subjectType,
    numberOrNull(body.parentId ?? body.parent_id, 'parentId'),
    numberOrNull(body.sortNo ?? body.sort_no, 'sortNo') || 0,
    assertAllowed(cleanString(body.status) || 'active', 'status', ['active', 'inactive']),
    cleanString(body.remark)
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM finance_subject WHERE code = ?', [code])
  return { data }
})
