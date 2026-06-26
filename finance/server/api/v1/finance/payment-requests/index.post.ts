import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { assertAllowed, cleanString, generateFinanceCode, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('PAY')
  const status = assertAllowed(cleanString(body.status) || 'draft', 'status', ['draft', 'pending_approval', 'approved', 'rejected', 'paid', 'canceled'])

  await execute(`
    INSERT INTO payment_request (
      code,
      title,
      payment_type,
      applicant_user_id,
      applicant_dept_code,
      project_code,
      contract_code,
      customer_code,
      supplier_code,
      payee_name,
      payee_account_masked,
      payee_account_secret_ref,
      payee_bank,
      requested_amount,
      planned_pay_date,
      bank_account_id,
      status,
      remark,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    cleanString(body.title) || '付款申请',
    cleanString(body.paymentType ?? body.payment_type) || 'other',
    cleanString(body.applicantUserId ?? body.applicant_user_id) || cleanString(body.createdBy ?? body.created_by) || 'unknown',
    cleanString(body.applicantDeptCode ?? body.applicant_dept_code),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.supplierCode ?? body.supplier_code),
    cleanString(body.payeeName ?? body.payee_name) || '未填写收款方',
    cleanString(body.payeeAccountMasked ?? body.payee_account_masked),
    cleanString(body.payeeAccountSecretRef ?? body.payee_account_secret_ref),
    cleanString(body.payeeBank ?? body.payee_bank),
    moneyString(body.requestedAmount ?? body.requested_amount, 'requestedAmount', { required: true, positive: true }),
    optionalDate(body.plannedPayDate ?? body.planned_pay_date),
    numberOrNull(body.bankAccountId ?? body.bank_account_id, 'bankAccountId'),
    status,
    cleanString(body.remark),
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by)
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>('SELECT * FROM payment_request WHERE code = ?', [code])
  return { data: row }
})
