import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, getQuery } from 'h3'
import { missingSchemaWarning, type ApiDataResult } from '../../../../utils/financeApi'
import { queryRows } from '../../../../utils/db'
import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from '../../../../utils/dataRuntime'

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

type SummaryRow = RowDataPacket & {
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

export default defineEventHandler(async (event): Promise<ApiDataResult<ContractFinanceSummary[]>> => {
  const query = getQuery(event)
  const codes = String(query.contractCodes || query.contract_codes || '')
    .split(',')
    .map(code => code.trim())
    .filter(Boolean)
    .slice(0, 100)

  if (codes.length === 0) return { data: [] }

  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/contracts/summaries', 'GET', query)
  const runtime = await maybeCallFinanceDataRuntime<ApiDataResult<ContractFinanceSummary[]>>(
    event,
    '/v1/finance/contracts/summaries',
    {
      scope: 'finance.contracts.read',
      query: authQuery
    }
  )
  if (runtime.handled) return runtime.data
  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery, 'Contract finance summaries fallback requires global contract finance access.')

  const seedSql = codes.map(() => 'SELECT ? AS contract_code').join(' UNION ALL ')
  const inSql = codes.map(() => '?').join(', ')

  try {
    const rows = await queryRows<SummaryRow[]>(`
      SELECT
        seed.contract_code,
        COALESCE(summary.customer_code, invoice.customer_code, receipt.customer_code) AS customer_code,
        COALESCE(summary.project_code, invoice.project_code, receipt.project_code) AS project_code,
        summary.contract_amount,
        COALESCE(summary.invoice_amount, invoice.invoice_amount, 0) AS invoice_amount,
        COALESCE(summary.received_amount, receipt.received_amount, 0) AS received_amount,
        COALESCE(summary.reconciled_amount, reconciliation.reconciled_amount, 0) AS reconciled_amount,
        summary.unreceived_amount,
        COALESCE(summary.unreconciled_amount, COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0)) AS unreconciled_amount,
        COALESCE(summary.invoice_count, invoice.invoice_count, 0) AS invoice_count,
        COALESCE(summary.receipt_count, receipt.receipt_count, 0) AS receipt_count,
        COALESCE(summary.latest_invoice_date, invoice.latest_invoice_date) AS latest_invoice_date,
        COALESCE(summary.latest_received_at, receipt.latest_received_at) AS latest_received_at,
        COALESCE(summary.risk_status, 'normal') AS risk_status,
        COALESCE(summary.calculated_at, NOW()) AS calculated_at
      FROM (${seedSql}) seed
      LEFT JOIN finance_contract_summary summary ON summary.contract_code = seed.contract_code
      LEFT JOIN (
        SELECT
          contract_code,
          MAX(customer_code) AS customer_code,
          MAX(project_code) AS project_code,
          SUM(invoice_amount) AS invoice_amount,
          COUNT(*) AS invoice_count,
          MAX(invoice_date) AS latest_invoice_date
        FROM finance_invoice
        WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code IN (${inSql})
        GROUP BY contract_code
      ) invoice ON invoice.contract_code = seed.contract_code
      LEFT JOIN (
        SELECT
          contract_code,
          MAX(customer_code) AS customer_code,
          MAX(project_code) AS project_code,
          SUM(received_amount) AS received_amount,
          COUNT(*) AS receipt_count,
          MAX(received_at) AS latest_received_at
        FROM finance_receipt
        WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code IN (${inSql})
        GROUP BY contract_code
      ) receipt ON receipt.contract_code = seed.contract_code
      LEFT JOIN (
        SELECT contract_code, SUM(reconciled_amount) AS reconciled_amount
        FROM finance_reconciliation
        WHERE status = 'active' AND contract_code IN (${inSql})
        GROUP BY contract_code
      ) reconciliation ON reconciliation.contract_code = seed.contract_code
    `, [...codes, ...codes, ...codes, ...codes])

    return { data: rows.map(normalizeSummary) }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return { warning, data: [] }
  }
})

function normalizeSummary(row: SummaryRow): ContractFinanceSummary {
  return {
    contractCode: row.contract_code,
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
