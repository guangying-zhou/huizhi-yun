import { maybeCallCurrentFinanceDataRuntime } from '../../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../../utils/db'
import { FINANCE_SUBJECT_TYPES, assertAllowed, cleanString, numberOrNull, type SqlParam } from '../../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const subjectType = assertAllowed(cleanString(body.subjectType ?? body.subject_type), 'subjectType', [...FINANCE_SUBJECT_TYPES])
  const status = assertAllowed(cleanString(body.status), 'status', ['active', 'inactive'])

  await execute(`
    UPDATE finance_subject
    SET
      name = COALESCE(?, name),
      subject_type = COALESCE(?, subject_type),
      parent_id = COALESCE(?, parent_id),
      sort_no = COALESCE(?, sort_no),
      status = COALESCE(?, status),
      remark = COALESCE(?, remark),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ?
  `, [
    cleanString(body.name),
    subjectType,
    numberOrNull(body.parentId ?? body.parent_id, 'parentId'),
    numberOrNull(body.sortNo ?? body.sort_no, 'sortNo'),
    status,
    cleanString(body.remark),
    code
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM finance_subject WHERE code = ?', [code])
  if (!data) throw createError({ statusCode: 404, statusMessage: 'subject not found' })
  return { data }
})
