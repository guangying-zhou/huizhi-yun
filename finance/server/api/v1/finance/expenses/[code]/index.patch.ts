import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { assertAllowed, cleanString, jsonOrNull, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['draft', 'pending_payment', 'paid', 'confirmed', 'canceled'])

  await execute(`
    UPDATE finance_expense
    SET
      expense_type_id = COALESCE(?, expense_type_id),
      subject_id = COALESCE(?, subject_id),
      expense_date = COALESCE(?, expense_date),
      expense_amount = COALESCE(?, expense_amount),
      fee_amount = COALESCE(?, fee_amount),
      currency_code = COALESCE(?, currency_code),
      bank_account_id = COALESCE(?, bank_account_id),
      project_code = COALESCE(?, project_code),
      contract_code = COALESCE(?, contract_code),
      customer_code = COALESCE(?, customer_code),
      department_code = COALESCE(?, department_code),
      handler_user_id = COALESCE(?, handler_user_id),
      payee_name = COALESCE(?, payee_name),
      payee_account_masked = COALESCE(?, payee_account_masked),
      payee_bank = COALESCE(?, payee_bank),
      payment_channel = COALESCE(?, payment_channel),
      source_request_type = COALESCE(?, source_request_type),
      source_request_code = COALESCE(?, source_request_code),
      status = COALESCE(?, status),
      description = COALESCE(?, description),
      source_refs_json = COALESCE(?, source_refs_json),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    numberOrNull(body.expenseTypeId ?? body.expense_type_id, 'expenseTypeId'),
    numberOrNull(body.subjectId ?? body.subject_id, 'subjectId'),
    optionalDate(body.expenseDate ?? body.expense_date),
    moneyString(body.expenseAmount ?? body.expense_amount, 'expenseAmount', { positive: true }),
    moneyString(body.feeAmount ?? body.fee_amount, 'feeAmount'),
    cleanString(body.currencyCode ?? body.currency_code),
    numberOrNull(body.bankAccountId ?? body.bank_account_id, 'bankAccountId'),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.departmentCode ?? body.department_code),
    cleanString(body.handlerUserId ?? body.handler_user_id),
    cleanString(body.payeeName ?? body.payee_name),
    cleanString(body.payeeAccountMasked ?? body.payee_account_masked),
    cleanString(body.payeeBank ?? body.payee_bank),
    cleanString(body.paymentChannel ?? body.payment_channel),
    cleanString(body.sourceRequestType ?? body.source_request_type),
    cleanString(body.sourceRequestCode ?? body.source_request_code),
    status,
    cleanString(body.description),
    jsonOrNull(body.sourceRefs ?? body.source_refs_json),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_expense WHERE code = ? AND deleted_at IS NULL', [code])
  if (!row) throw createError({ statusCode: 404, statusMessage: 'expense not found' })
  return { data: row }
})
