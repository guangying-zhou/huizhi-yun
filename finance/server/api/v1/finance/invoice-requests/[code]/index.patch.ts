import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { assertAllowed, cleanString, jsonOrNull, moneyString, numberOrNull, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const current = await queryRow<RowDataPacket & { status: string }>(
    'SELECT status FROM invoice_request WHERE code = ? AND deleted_at IS NULL',
    [code]
  )
  if (!current) throw createError({ statusCode: 404, statusMessage: 'invoice request not found' })
  if (!['draft', 'rejected'].includes(String(current.status))) {
    throw createError({ statusCode: 409, statusMessage: 'only draft or rejected invoice requests can be edited' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['draft', 'canceled'])

  await execute(`
    UPDATE invoice_request
    SET
      customer_code = COALESCE(?, customer_code),
      customer_name = COALESCE(?, customer_name),
      contract_code = COALESCE(?, contract_code),
      receivable_plan_code = COALESCE(?, receivable_plan_code),
      invoice_type = COALESCE(?, invoice_type),
      invoice_item = COALESCE(?, invoice_item),
      requested_amount = COALESCE(?, requested_amount),
      tax_rate = COALESCE(?, tax_rate),
      taxpayer_name = COALESCE(?, taxpayer_name),
      taxpayer_no = COALESCE(?, taxpayer_no),
      billing_info_json = COALESCE(?, billing_info_json),
      status = COALESCE(?, status),
      requested_by = COALESCE(?, requested_by),
      remark = COALESCE(?, remark),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.customerName ?? body.customer_name),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
    cleanString(body.invoiceType ?? body.invoice_type),
    cleanString(body.invoiceItem ?? body.invoice_item),
    moneyString(body.requestedAmount ?? body.requested_amount, 'requestedAmount', { positive: true }),
    numberOrNull(body.taxRate ?? body.tax_rate, 'taxRate'),
    cleanString(body.taxpayerName ?? body.taxpayer_name),
    cleanString(body.taxpayerNo ?? body.taxpayer_no),
    jsonOrNull(body.billingInfo ?? body.billing_info_json),
    status,
    cleanString(body.requestedBy ?? body.requested_by),
    cleanString(body.remark),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM invoice_request WHERE code = ? AND deleted_at IS NULL', [code])
  return { data }
})
