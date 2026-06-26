import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { missingSchemaWarning, type ApiDataResult } from '../../../../../utils/financeApi'
import { queryRow } from '../../../../../utils/db'
import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery,
  maybeCallCurrentFinanceDataRuntime
} from '../../../../../utils/dataRuntime'

interface ContractFinanceSummary {
  contractCode: string
  customerCode: string | null
  projectCode: string | null
  contractAmount: string | null
  invoiceAmount: string
  receivedAmount: string
  reconciledAmount: string
  unreceivedAmount: string | null
  unreconciledAmount: string | null
  invoiceCount: number
  receiptCount: number
  latestInvoiceDate: string | null
  latestReceivedAt: string | null
  riskStatus: string
  calculatedAt: string | null
}

type ContractSummaryRow = RowDataPacket & {
  contract_code: string
  customer_code: string | null
  project_code: string | null
  contract_amount: string | null
  invoice_amount: string | null
  received_amount: string | null
  reconciled_amount: string | null
  unreceived_amount: string | null
  unreconciled_amount: string | null
  invoice_count: number | null
  receipt_count: number | null
  latest_invoice_date: string | null
  latest_received_at: string | null
  risk_status: string | null
  calculated_at: string | null
}

export default defineEventHandler(async (event): Promise<ApiDataResult<ContractFinanceSummary>> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<ApiDataResult<ContractFinanceSummary>>(event)
  if (runtime.handled) return runtime.data

  const contractCode = String(getRouterParam(event, 'contractCode') || '').trim()
  if (!contractCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'contractCode is required'
    })
  }
  const authQuery = await buildFinanceRuntimeAuthQuery(event, `/v1/finance/contracts/${encodeURIComponent(contractCode)}/summary`, 'GET')
  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery, 'Contract finance summary fallback requires global contract finance access.')

  try {
    const row = await queryRow<ContractSummaryRow>(`
      SELECT
        summary.contract_code,
        summary.customer_code,
        summary.project_code,
        summary.contract_amount,
        summary.invoice_amount,
        summary.received_amount,
        summary.reconciled_amount,
        summary.unreceived_amount,
        summary.unreconciled_amount,
        summary.invoice_count,
        summary.receipt_count,
        summary.latest_invoice_date,
        summary.latest_received_at,
        summary.risk_status,
        summary.calculated_at
      FROM finance_contract_summary summary
      WHERE summary.contract_code = ?
      LIMIT 1
    `, [contractCode])

    if (row) {
      return { data: normalizeSummary(row, contractCode) }
    }

    const computed = await queryRow<ContractSummaryRow>(`
      SELECT
        ? AS contract_code,
        COALESCE(invoice.customer_code, receipt.customer_code) AS customer_code,
        COALESCE(invoice.project_code, receipt.project_code) AS project_code,
        NULL AS contract_amount,
        COALESCE(invoice.invoice_amount, 0) AS invoice_amount,
        COALESCE(receipt.received_amount, 0) AS received_amount,
        COALESCE(reconciliation.reconciled_amount, 0) AS reconciled_amount,
        NULL AS unreceived_amount,
        COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0) AS unreconciled_amount,
        COALESCE(invoice.invoice_count, 0) AS invoice_count,
        COALESCE(receipt.receipt_count, 0) AS receipt_count,
        invoice.latest_invoice_date,
        receipt.latest_received_at,
        'normal' AS risk_status,
        NOW() AS calculated_at
      FROM (SELECT 1) seed
      LEFT JOIN (
        SELECT
          contract_code,
          MAX(customer_code) AS customer_code,
          MAX(project_code) AS project_code,
          SUM(invoice_amount) AS invoice_amount,
          COUNT(*) AS invoice_count,
          MAX(invoice_date) AS latest_invoice_date
        FROM finance_invoice
        WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code = ?
        GROUP BY contract_code
      ) invoice ON TRUE
      LEFT JOIN (
        SELECT
          contract_code,
          MAX(customer_code) AS customer_code,
          MAX(project_code) AS project_code,
          SUM(received_amount) AS received_amount,
          COUNT(*) AS receipt_count,
          MAX(received_at) AS latest_received_at
        FROM finance_receipt
        WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code = ?
        GROUP BY contract_code
      ) receipt ON TRUE
      LEFT JOIN (
        SELECT contract_code, SUM(reconciled_amount) AS reconciled_amount
        FROM finance_reconciliation
        WHERE status = 'active' AND contract_code = ?
        GROUP BY contract_code
      ) reconciliation ON TRUE
    `, [contractCode, contractCode, contractCode, contractCode])

    return {
      data: normalizeSummary(computed, contractCode)
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      warning,
      data: emptySummary(contractCode)
    }
  }
})

function normalizeSummary(row: ContractSummaryRow | null, contractCode: string): ContractFinanceSummary {
  if (!row) return emptySummary(contractCode)
  return {
    contractCode,
    customerCode: row.customer_code,
    projectCode: row.project_code,
    contractAmount: row.contract_amount === null ? null : String(row.contract_amount),
    invoiceAmount: String(row.invoice_amount || '0.00'),
    receivedAmount: String(row.received_amount || '0.00'),
    reconciledAmount: String(row.reconciled_amount || '0.00'),
    unreceivedAmount: row.unreceived_amount === null ? null : String(row.unreceived_amount),
    unreconciledAmount: row.unreconciled_amount === null ? null : String(row.unreconciled_amount),
    invoiceCount: Number(row.invoice_count || 0),
    receiptCount: Number(row.receipt_count || 0),
    latestInvoiceDate: row.latest_invoice_date,
    latestReceivedAt: row.latest_received_at,
    riskStatus: row.risk_status || 'normal',
    calculatedAt: row.calculated_at
  }
}

function emptySummary(contractCode: string): ContractFinanceSummary {
  return {
    contractCode,
    customerCode: null,
    projectCode: null,
    contractAmount: null,
    invoiceAmount: '0.00',
    receivedAmount: '0.00',
    reconciledAmount: '0.00',
    unreceivedAmount: null,
    unreconciledAmount: null,
    invoiceCount: 0,
    receiptCount: 0,
    latestInvoiceDate: null,
    latestReceivedAt: null,
    riskStatus: 'normal',
    calculatedAt: null
  }
}
