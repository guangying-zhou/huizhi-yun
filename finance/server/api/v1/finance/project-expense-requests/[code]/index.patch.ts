import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { assertAllowed, cleanString, moneyString, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const current = await queryRow<RowDataPacket & { status: string }>(
    'SELECT status FROM project_expense_request WHERE code = ? AND deleted_at IS NULL',
    [code]
  )
  if (!current) throw createError({ statusCode: 404, statusMessage: 'project expense request not found' })
  if (!['draft', 'rejected'].includes(String(current.status))) {
    throw createError({ statusCode: 409, statusMessage: 'only draft or rejected project expense requests can be edited' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['draft', 'canceled'])

  await execute(`
    UPDATE project_expense_request
    SET
      title = COALESCE(?, title),
      applicant_user_id = COALESCE(?, applicant_user_id),
      applicant_dept_code = COALESCE(?, applicant_dept_code),
      project_code = COALESCE(?, project_code),
      contract_code = COALESCE(?, contract_code),
      customer_code = COALESCE(?, customer_code),
      supplier_code = COALESCE(?, supplier_code),
      total_amount = COALESCE(?, total_amount),
      status = COALESCE(?, status),
      remark = COALESCE(?, remark),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    cleanString(body.title),
    cleanString(body.applicantUserId ?? body.applicant_user_id),
    cleanString(body.applicantDeptCode ?? body.applicant_dept_code),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.supplierCode ?? body.supplier_code),
    moneyString(body.totalAmount ?? body.total_amount, 'totalAmount', { positive: true }),
    status,
    cleanString(body.remark),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM project_expense_request WHERE code = ? AND deleted_at IS NULL', [code])
  return { data }
})
