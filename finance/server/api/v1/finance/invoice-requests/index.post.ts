import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { assertAllowed, cleanString, generateFinanceCode, jsonOrNull, moneyString, numberOrNull, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('IR')
  const status = assertAllowed(cleanString(body.status) || 'draft', 'status', ['draft', 'pending_approval', 'approved', 'rejected', 'issued', 'canceled'])

  await execute(`
    INSERT INTO invoice_request (
      code,
      source_app,
      source_biz_type,
      source_biz_code,
      customer_code,
      customer_name,
      contract_code,
      receivable_plan_code,
      invoice_type,
      invoice_item,
      requested_amount,
      tax_rate,
      taxpayer_name,
      taxpayer_no,
      billing_info_json,
      status,
      requested_by,
      remark,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    cleanString(body.sourceApp ?? body.source_app) || 'finance',
    cleanString(body.sourceBizType ?? body.source_biz_type),
    cleanString(body.sourceBizCode ?? body.source_biz_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.customerName ?? body.customer_name),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
    cleanString(body.invoiceType ?? body.invoice_type),
    cleanString(body.invoiceItem ?? body.invoice_item),
    moneyString(body.requestedAmount ?? body.requested_amount, 'requestedAmount', { required: true, positive: true }),
    numberOrNull(body.taxRate ?? body.tax_rate, 'taxRate'),
    cleanString(body.taxpayerName ?? body.taxpayer_name),
    cleanString(body.taxpayerNo ?? body.taxpayer_no),
    jsonOrNull(body.billingInfo ?? body.billing_info_json),
    status,
    cleanString(body.requestedBy ?? body.requested_by),
    cleanString(body.remark),
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by)
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>('SELECT * FROM invoice_request WHERE code = ?', [code])
  return { data: row }
})
