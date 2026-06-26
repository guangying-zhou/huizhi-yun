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

  const before = await queryRow<RowDataPacket & { contract_code: string | null }>('SELECT contract_code FROM finance_invoice WHERE code = ? AND deleted_at IS NULL', [code])
  if (!before) throw createError({ statusCode: 404, statusMessage: 'invoice not found' })

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['draft', 'issued', 'red_reversed', 'canceled'])
  const invoiceMedium = assertAllowed(cleanString(body.invoiceMedium ?? body.invoice_medium), 'invoiceMedium', ['electronic', 'paper'])
  const contractCode = cleanString(body.contractCode ?? body.contract_code)

  await execute(`
    UPDATE finance_invoice
    SET
      invoice_no = COALESCE(?, invoice_no),
      customer_code = COALESCE(?, customer_code),
      customer_name = COALESCE(?, customer_name),
      contract_code = COALESCE(?, contract_code),
      project_code = COALESCE(?, project_code),
      receivable_plan_code = COALESCE(?, receivable_plan_code),
      invoice_type = COALESCE(?, invoice_type),
      invoice_medium = COALESCE(?, invoice_medium),
      invoice_item = COALESCE(?, invoice_item),
      invoice_amount = COALESCE(?, invoice_amount),
      tax_rate = COALESCE(?, tax_rate),
      tax_amount = COALESCE(?, tax_amount),
      amount_tax_exclusive = COALESCE(?, amount_tax_exclusive),
      invoice_date = COALESCE(?, invoice_date),
      status = COALESCE(?, status),
      taxpayer_name = COALESCE(?, taxpayer_name),
      taxpayer_no = COALESCE(?, taxpayer_no),
      receiver_name = COALESCE(?, receiver_name),
      invoice_file_url = COALESCE(?, invoice_file_url),
      invoice_file_name = COALESCE(?, invoice_file_name),
      invoice_file_mime_type = COALESCE(?, invoice_file_mime_type),
      invoice_file_size = COALESCE(?, invoice_file_size),
      source_refs_json = COALESCE(?, source_refs_json),
      remark = COALESCE(?, remark),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    cleanString(body.invoiceNo ?? body.invoice_no),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.customerName ?? body.customer_name),
    contractCode,
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
    cleanString(body.invoiceType ?? body.invoice_type),
    invoiceMedium,
    cleanString(body.invoiceItem ?? body.invoice_item),
    moneyString(body.invoiceAmount ?? body.invoice_amount, 'invoiceAmount', { positive: true }),
    numberOrNull(body.taxRate ?? body.tax_rate, 'taxRate'),
    moneyString(body.taxAmount ?? body.tax_amount, 'taxAmount'),
    moneyString(body.amountTaxExclusive ?? body.amount_tax_exclusive, 'amountTaxExclusive'),
    optionalDate(body.invoiceDate ?? body.invoice_date),
    status,
    cleanString(body.taxpayerName ?? body.taxpayer_name),
    cleanString(body.taxpayerNo ?? body.taxpayer_no),
    cleanString(body.receiverName ?? body.receiver_name),
    cleanString(body.invoiceFileUrl ?? body.invoice_file_url),
    cleanString(body.invoiceFileName ?? body.invoice_file_name),
    cleanString(body.invoiceFileMimeType ?? body.invoice_file_mime_type),
    numberOrNull(body.invoiceFileSize ?? body.invoice_file_size, 'invoiceFileSize'),
    jsonOrNull(body.sourceRefs ?? body.source_refs_json),
    cleanString(body.remark),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  await recalculateContractSummary(before.contract_code)
  await recalculateContractSummary(contractCode)
  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_invoice WHERE code = ? AND deleted_at IS NULL', [code])
  return { data: row }
})
