import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { recalculateContractSummary } from '../../../../utils/financeSummary'
import { FINANCE_ACCOUNTING_OBJECT_TYPES, FINANCE_RECEIPT_SOURCE_TYPES, assertAllowed, cleanString, generateFinanceCode, jsonOrNull, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('RCV')
  const contractCode = cleanString(body.contractCode ?? body.contract_code)
  const receivedAmount = moneyString(body.receivedAmount ?? body.received_amount, 'receivedAmount', { required: true, positive: true })
  const reconciledAmount = moneyString(body.reconciledAmount ?? body.reconciled_amount, 'reconciledAmount') || '0.00'
  const unreconciledAmount = moneyString(body.unreconciledAmount ?? body.unreconciled_amount, 'unreconciledAmount') || (Number(receivedAmount) - Number(reconciledAmount)).toFixed(2)
  const status = assertAllowed(cleanString(body.status) || 'confirmed', 'status', ['draft', 'confirmed', 'partially_reconciled', 'reconciled', 'canceled'])
  const receiptSourceType = assertAllowed(cleanString(body.receiptSourceType ?? body.receipt_source_type) || (contractCode ? 'contract' : 'no_contract'), 'receiptSourceType', [...FINANCE_RECEIPT_SOURCE_TYPES])
  const accountingObjectType = assertAllowed(cleanString(body.accountingObjectType ?? body.accounting_object_type), 'accountingObjectType', [...FINANCE_ACCOUNTING_OBJECT_TYPES])

  await execute(`
    INSERT INTO finance_receipt (
      code,
      receipt_no,
      customer_code,
      customer_name,
      contract_code,
      project_code,
      receivable_plan_code,
      receipt_source_type,
      accounting_object_type,
      accounting_object_code,
      bank_account_id,
      income_type_id,
      received_amount,
      reconciled_amount,
      unreconciled_amount,
      received_at,
      channel,
      payer_name,
      handler_user_id,
      status,
      source_refs_json,
      note,
      confirmed_by,
      confirmed_at,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    cleanString(body.receiptNo ?? body.receipt_no),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.customerName ?? body.customer_name),
    contractCode,
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
    receiptSourceType,
    accountingObjectType,
    cleanString(body.accountingObjectCode ?? body.accounting_object_code),
    numberOrNull(body.bankAccountId ?? body.bank_account_id, 'bankAccountId'),
    numberOrNull(body.incomeTypeId ?? body.income_type_id, 'incomeTypeId'),
    receivedAmount,
    reconciledAmount,
    unreconciledAmount,
    optionalDate(body.receivedAt ?? body.received_at) || requiredToday(),
    cleanString(body.channel),
    cleanString(body.payerName ?? body.payer_name),
    cleanString(body.handlerUserId ?? body.handler_user_id),
    status,
    jsonOrNull(body.sourceRefs ?? body.source_refs_json),
    cleanString(body.note),
    cleanString(body.confirmedBy ?? body.confirmed_by),
    cleanString(body.confirmedAt ?? body.confirmed_at),
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by)
  ] satisfies SqlParam[])

  await recalculateContractSummary(contractCode)
  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_receipt WHERE code = ?', [code])
  return { data: row }
})

function requiredToday(): string {
  return new Date().toISOString().slice(0, 10)
}
