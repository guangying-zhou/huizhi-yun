import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { FINANCE_ACCOUNTING_OBJECT_TYPES, FINANCE_SALES_SCOPE_TYPES, assertAllowed, cleanString, generateFinanceCode, jsonOrNull, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('EXP')
  const status = assertAllowed(cleanString(body.status) || 'confirmed', 'status', ['draft', 'pending_payment', 'paid', 'confirmed', 'canceled'])
  const accountingObjectType = assertAllowed(cleanString(body.accountingObjectType ?? body.accounting_object_type), 'accountingObjectType', [...FINANCE_ACCOUNTING_OBJECT_TYPES])
  const salesScopeType = assertAllowed(cleanString(body.salesScopeType ?? body.sales_scope_type), 'salesScopeType', [...FINANCE_SALES_SCOPE_TYPES])

  await execute(`
    INSERT INTO finance_expense (
      code,
      expense_type_id,
      subject_id,
      expense_date,
      expense_amount,
      fee_amount,
      currency_code,
      bank_account_id,
      project_code,
      contract_code,
      customer_code,
      department_code,
      accounting_object_type,
      accounting_object_code,
      sales_scope_type,
      sales_scope_code,
      sales_region_code,
      sales_owner_uid,
      handler_user_id,
      payee_name,
      payee_account_masked,
      payee_bank,
      payment_channel,
      source_request_type,
      source_request_code,
      status,
      description,
      source_refs_json,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    numberOrNull(body.expenseTypeId ?? body.expense_type_id, 'expenseTypeId'),
    numberOrNull(body.subjectId ?? body.subject_id, 'subjectId'),
    optionalDate(body.expenseDate ?? body.expense_date) || new Date().toISOString().slice(0, 10),
    moneyString(body.expenseAmount ?? body.expense_amount, 'expenseAmount', { required: true, positive: true }),
    moneyString(body.feeAmount ?? body.fee_amount, 'feeAmount') || '0.00',
    cleanString(body.currencyCode ?? body.currency_code) || 'CNY',
    numberOrNull(body.bankAccountId ?? body.bank_account_id, 'bankAccountId'),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.departmentCode ?? body.department_code),
    accountingObjectType,
    cleanString(body.accountingObjectCode ?? body.accounting_object_code),
    salesScopeType,
    cleanString(body.salesScopeCode ?? body.sales_scope_code),
    cleanString(body.salesRegionCode ?? body.sales_region_code),
    cleanString(body.salesOwnerUid ?? body.sales_owner_uid),
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
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by)
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_expense WHERE code = ?', [code])
  return { data: row }
})
