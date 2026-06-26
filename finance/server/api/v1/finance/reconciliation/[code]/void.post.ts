import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { PoolConnection, RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDbPool } from '../../../../../utils/db'
import { recalculateContractSummary } from '../../../../../utils/financeSummary'
import { cleanString, type SqlParam } from '../../../../../utils/financeWrite'

type ReconciliationRow = RowDataPacket & {
  id: number
  receipt_id: number
  contract_code: string | null
}

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const connection = await useDbPool().getConnection()

  try {
    await connection.beginTransaction()

    const [rows] = await connection.query<ReconciliationRow[]>(
      `SELECT id, receipt_id, contract_code
       FROM finance_reconciliation
       WHERE code = ? AND status = 'active'
       FOR UPDATE`,
      [code]
    )
    const reconciliation = rows[0]
    if (!reconciliation) {
      throw createError({ statusCode: 404, statusMessage: 'active reconciliation not found' })
    }

    await connection.execute(`
      UPDATE finance_reconciliation
      SET status = 'reversed',
          reversed_at = NOW(),
          reversed_by = ?,
          reverse_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      cleanString(body.reversedBy ?? body.reversed_by),
      cleanString(body.reverseReason ?? body.reverse_reason),
      reconciliation.id
    ] satisfies SqlParam[])

    await updateReceiptReconciliationState(connection, reconciliation.receipt_id)
    await recalculateContractSummary(reconciliation.contract_code, connection)

    await connection.commit()

    const [updatedRows] = await connection.query<RowDataPacket[]>('SELECT * FROM finance_reconciliation WHERE code = ?', [code])
    return { data: updatedRows[0] || null }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
})

async function updateReceiptReconciliationState(connection: PoolConnection, receiptId: number): Promise<void> {
  const [rows] = await connection.query<(RowDataPacket & { received_amount: string, reconciled_amount: string })[]>(`
    SELECT
      receipt.received_amount,
      COALESCE(SUM(CASE WHEN reconciliation.status = 'active' THEN reconciliation.reconciled_amount ELSE 0 END), 0) AS reconciled_amount
    FROM finance_receipt receipt
    LEFT JOIN finance_reconciliation reconciliation ON reconciliation.receipt_id = receipt.id
    WHERE receipt.id = ?
    GROUP BY receipt.id, receipt.received_amount
  `, [receiptId])

  const receivedAmount = Number(rows[0]?.received_amount || 0)
  const reconciledAmount = Number(rows[0]?.reconciled_amount || 0)
  const unreconciledAmount = Math.max(receivedAmount - reconciledAmount, 0)
  const status = reconciledAmount <= 0
    ? 'confirmed'
    : unreconciledAmount <= 0.000001 ? 'reconciled' : 'partially_reconciled'

  await connection.execute(`
    UPDATE finance_receipt
    SET reconciled_amount = ?, unreconciled_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [reconciledAmount.toFixed(2), unreconciledAmount.toFixed(2), status, receiptId])
}
