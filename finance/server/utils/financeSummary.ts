import type { PoolConnection, RowDataPacket } from '~~/server/utils/db'
import { execute, queryRow } from './db'
import type { SqlParam } from './financeWrite'

type Queryable = {
  query: <T extends RowDataPacket[]>(sql: string, params?: SqlParam[]) => Promise<[T, unknown]>
  execute: (sql: string, params?: SqlParam[]) => Promise<[unknown, unknown]>
}

type SummaryTotals = RowDataPacket & {
  customer_code: string | null
  project_code: string | null
  invoice_amount: string | null
  received_amount: string | null
  reconciled_amount: string | null
  invoice_count: number | null
  receipt_count: number | null
  latest_invoice_date: string | null
  latest_received_at: string | null
}

export async function recalculateContractSummary(contractCode: string | null, connection?: PoolConnection): Promise<void> {
  if (!contractCode) return

  const row = connection
    ? await querySummaryWithConnection(connection, contractCode)
    : await querySummary(contractCode)

  const invoiceAmount = Number(row?.invoice_amount || 0)
  const receivedAmount = Number(row?.received_amount || 0)
  const reconciledAmount = Number(row?.reconciled_amount || 0)
  const unreconciledAmount = Math.max(receivedAmount - reconciledAmount, 0)

  const params: SqlParam[] = [
    contractCode,
    row?.customer_code || null,
    row?.project_code || null,
    invoiceAmount.toFixed(2),
    receivedAmount.toFixed(2),
    reconciledAmount.toFixed(2),
    null,
    unreconciledAmount.toFixed(2),
    Number(row?.invoice_count || 0),
    Number(row?.receipt_count || 0),
    row?.latest_invoice_date || null,
    row?.latest_received_at || null
  ]

  const sql = `
    INSERT INTO finance_contract_summary (
      contract_code,
      customer_code,
      project_code,
      invoice_amount,
      received_amount,
      reconciled_amount,
      unreceived_amount,
      unreconciled_amount,
      invoice_count,
      receipt_count,
      latest_invoice_date,
      latest_received_at,
      calculated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      customer_code = VALUES(customer_code),
      project_code = VALUES(project_code),
      invoice_amount = VALUES(invoice_amount),
      received_amount = VALUES(received_amount),
      reconciled_amount = VALUES(reconciled_amount),
      unreceived_amount = VALUES(unreceived_amount),
      unreconciled_amount = VALUES(unreconciled_amount),
      invoice_count = VALUES(invoice_count),
      receipt_count = VALUES(receipt_count),
      latest_invoice_date = VALUES(latest_invoice_date),
      latest_received_at = VALUES(latest_received_at),
      calculated_at = NOW()
  `

  if (connection) {
    await connection.execute(sql, params)
  } else {
    await execute(sql, params)
  }
}

async function querySummary(contractCode: string): Promise<SummaryTotals | null> {
  return queryRow<SummaryTotals>(summarySql(), [contractCode, contractCode, contractCode])
}

async function querySummaryWithConnection(connection: Queryable, contractCode: string): Promise<SummaryTotals | null> {
  const [rows] = await connection.query<SummaryTotals[]>(summarySql(), [contractCode, contractCode, contractCode])
  return rows[0] || null
}

function summarySql(): string {
  return `
    SELECT
      COALESCE(invoice.customer_code, receipt.customer_code, reconciliation.customer_code) AS customer_code,
      COALESCE(invoice.project_code, receipt.project_code, reconciliation.project_code) AS project_code,
      COALESCE(invoice.invoice_amount, 0) AS invoice_amount,
      COALESCE(receipt.received_amount, 0) AS received_amount,
      COALESCE(reconciliation.reconciled_amount, 0) AS reconciled_amount,
      COALESCE(invoice.invoice_count, 0) AS invoice_count,
      COALESCE(receipt.receipt_count, 0) AS receipt_count,
      invoice.latest_invoice_date,
      receipt.latest_received_at
    FROM (SELECT 1) seed
    LEFT JOIN (
      SELECT
        MAX(customer_code) AS customer_code,
        MAX(project_code) AS project_code,
        SUM(invoice_amount) AS invoice_amount,
        COUNT(*) AS invoice_count,
        MAX(invoice_date) AS latest_invoice_date
      FROM finance_invoice
      WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code = ?
    ) invoice ON TRUE
    LEFT JOIN (
      SELECT
        MAX(customer_code) AS customer_code,
        MAX(project_code) AS project_code,
        SUM(received_amount) AS received_amount,
        COUNT(*) AS receipt_count,
        MAX(received_at) AS latest_received_at
      FROM finance_receipt
      WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code = ?
    ) receipt ON TRUE
    LEFT JOIN (
      SELECT
        MAX(customer_code) AS customer_code,
        MAX(project_code) AS project_code,
        SUM(reconciled_amount) AS reconciled_amount
      FROM finance_reconciliation
      WHERE status = 'active' AND contract_code = ?
    ) reconciliation ON TRUE
  `
}
