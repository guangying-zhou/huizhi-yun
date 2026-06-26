import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { assertAllowed, cleanString, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const current = await queryRow<RowDataPacket & { status: string }>(
    'SELECT status FROM payment_request WHERE code = ? AND deleted_at IS NULL',
    [code]
  )
  if (!current) throw createError({ statusCode: 404, statusMessage: 'payment request not found' })
  if (!['draft', 'rejected'].includes(String(current.status))) {
    throw createError({ statusCode: 409, statusMessage: 'only draft or rejected payment requests can be edited' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['draft', 'canceled'])

  await execute(`
    UPDATE payment_request
    SET
      title = COALESCE(?, title),
      payment_type = COALESCE(?, payment_type),
      applicant_user_id = COALESCE(?, applicant_user_id),
      applicant_dept_code = COALESCE(?, applicant_dept_code),
      project_code = COALESCE(?, project_code),
      contract_code = COALESCE(?, contract_code),
      customer_code = COALESCE(?, customer_code),
      supplier_code = COALESCE(?, supplier_code),
      payee_name = COALESCE(?, payee_name),
      payee_account_masked = COALESCE(?, payee_account_masked),
      payee_account_secret_ref = COALESCE(?, payee_account_secret_ref),
      payee_bank = COALESCE(?, payee_bank),
      requested_amount = COALESCE(?, requested_amount),
      planned_pay_date = COALESCE(?, planned_pay_date),
      bank_account_id = COALESCE(?, bank_account_id),
      status = COALESCE(?, status),
      remark = COALESCE(?, remark),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    cleanString(body.title),
    cleanString(body.paymentType ?? body.payment_type),
    cleanString(body.applicantUserId ?? body.applicant_user_id),
    cleanString(body.applicantDeptCode ?? body.applicant_dept_code),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.supplierCode ?? body.supplier_code),
    cleanString(body.payeeName ?? body.payee_name),
    cleanString(body.payeeAccountMasked ?? body.payee_account_masked),
    cleanString(body.payeeAccountSecretRef ?? body.payee_account_secret_ref),
    cleanString(body.payeeBank ?? body.payee_bank),
    moneyString(body.requestedAmount ?? body.requested_amount, 'requestedAmount', { positive: true }),
    optionalDate(body.plannedPayDate ?? body.planned_pay_date),
    numberOrNull(body.bankAccountId ?? body.bank_account_id, 'bankAccountId'),
    status,
    cleanString(body.remark),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM payment_request WHERE code = ? AND deleted_at IS NULL', [code])
  return { data }
})
