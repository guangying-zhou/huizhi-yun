import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { recalculateContractSummary } from '../../../../../utils/financeSummary'
import { assertAllowed, cleanString, jsonOrNull, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const before = await queryRow<RowDataPacket & { contract_code: string | null }>('SELECT contract_code FROM finance_receipt WHERE code = ? AND deleted_at IS NULL', [code])
  if (!before) throw createError({ statusCode: 404, statusMessage: 'receipt not found' })

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['draft', 'confirmed', 'partially_reconciled', 'reconciled', 'canceled'])
  const contractCode = cleanString(body.contractCode ?? body.contract_code)

  await execute(`
    UPDATE finance_receipt
    SET
      receipt_no = COALESCE(?, receipt_no),
      customer_code = COALESCE(?, customer_code),
      customer_name = COALESCE(?, customer_name),
      contract_code = COALESCE(?, contract_code),
      project_code = COALESCE(?, project_code),
      receivable_plan_code = COALESCE(?, receivable_plan_code),
      bank_account_id = COALESCE(?, bank_account_id),
      income_type_id = COALESCE(?, income_type_id),
      received_amount = COALESCE(?, received_amount),
      unreconciled_amount = COALESCE(?, unreconciled_amount),
      received_at = COALESCE(?, received_at),
      channel = COALESCE(?, channel),
      payer_name = COALESCE(?, payer_name),
      handler_user_id = COALESCE(?, handler_user_id),
      status = COALESCE(?, status),
      source_refs_json = COALESCE(?, source_refs_json),
      note = COALESCE(?, note),
      confirmed_by = COALESCE(?, confirmed_by),
      confirmed_at = COALESCE(?, confirmed_at),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    cleanString(body.receiptNo ?? body.receipt_no),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.customerName ?? body.customer_name),
    contractCode,
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
    numberOrNull(body.bankAccountId ?? body.bank_account_id, 'bankAccountId'),
    numberOrNull(body.incomeTypeId ?? body.income_type_id, 'incomeTypeId'),
    moneyString(body.receivedAmount ?? body.received_amount, 'receivedAmount', { positive: true }),
    moneyString(body.unreconciledAmount ?? body.unreconciled_amount, 'unreconciledAmount'),
    optionalDate(body.receivedAt ?? body.received_at),
    cleanString(body.channel),
    cleanString(body.payerName ?? body.payer_name),
    cleanString(body.handlerUserId ?? body.handler_user_id),
    status,
    jsonOrNull(body.sourceRefs ?? body.source_refs_json),
    cleanString(body.note),
    cleanString(body.confirmedBy ?? body.confirmed_by),
    cleanString(body.confirmedAt ?? body.confirmed_at),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  await recalculateContractSummary(before.contract_code)
  await recalculateContractSummary(contractCode)
  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_receipt WHERE code = ? AND deleted_at IS NULL', [code])
  return { data: row }
})
