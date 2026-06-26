import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { recalculateContractSummary } from '../../../../utils/financeSummary'
import { assertAllowed, cleanString, generateFinanceCode, jsonOrNull, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('INV')
  const contractCode = cleanString(body.contractCode ?? body.contract_code)
  const status = assertAllowed(cleanString(body.status) || 'issued', 'status', ['draft', 'issued', 'red_reversed', 'canceled'])
  const invoiceMedium = assertAllowed(cleanString(body.invoiceMedium ?? body.invoice_medium) || 'electronic', 'invoiceMedium', ['electronic', 'paper'])
  const invoiceAmount = moneyString(body.invoiceAmount ?? body.invoice_amount, 'invoiceAmount', { required: true, positive: true })
  const taxAmount = moneyString(body.taxAmount ?? body.tax_amount, 'taxAmount')

  await execute(`
    INSERT INTO finance_invoice (
      code,
      invoice_no,
      customer_code,
      customer_name,
      contract_code,
      project_code,
      receivable_plan_code,
      invoice_type,
      invoice_medium,
      invoice_item,
      invoice_amount,
      tax_rate,
      tax_amount,
      amount_tax_exclusive,
      invoice_date,
      status,
      taxpayer_name,
      taxpayer_no,
      receiver_name,
      invoice_file_url,
      invoice_file_name,
      invoice_file_mime_type,
      invoice_file_size,
      source_refs_json,
      remark,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    cleanString(body.invoiceNo ?? body.invoice_no),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.customerName ?? body.customer_name),
    contractCode,
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
    cleanString(body.invoiceType ?? body.invoice_type),
    invoiceMedium,
    cleanString(body.invoiceItem ?? body.invoice_item),
    invoiceAmount,
    numberOrNull(body.taxRate ?? body.tax_rate, 'taxRate'),
    taxAmount,
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
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by)
  ] satisfies SqlParam[])

  await recalculateContractSummary(contractCode)
  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_invoice WHERE code = ?', [code])
  return { data: row }
})
