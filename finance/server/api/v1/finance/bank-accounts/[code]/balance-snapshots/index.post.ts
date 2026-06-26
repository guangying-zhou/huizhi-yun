import { maybeCallCurrentFinanceDataRuntime } from '../../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../../utils/db'
import { cleanString, moneyString, optionalDate, type SqlParam } from '../../../../../../utils/financeWrite'
import { getRequestUid } from '../../../../../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const account = await queryRow<RowDataPacket & { id: number }>(
    'SELECT id FROM finance_bank_account WHERE code = ? AND deleted_at IS NULL',
    [code]
  )
  if (!account) throw createError({ statusCode: 404, statusMessage: 'bank account not found' })

  const snapshotDate = optionalDate(body.snapshotDate ?? body.snapshot_date) || new Date().toISOString().slice(0, 10)
  const sourceType = 'manual'
  const createdBy = cleanString(getRequestUid(event)) || 'unknown'

  await execute(`
    INSERT INTO finance_account_balance_snapshot (
      bank_account_id,
      snapshot_date,
      balance_amount,
      currency_code,
      source_type,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      balance_amount = VALUES(balance_amount),
      currency_code = VALUES(currency_code),
      created_by = VALUES(created_by),
      created_at = CURRENT_TIMESTAMP
  `, [
    account.id,
    snapshotDate,
    moneyString(body.balanceAmount ?? body.balance_amount, 'balanceAmount', { required: true }),
    cleanString(body.currencyCode ?? body.currency_code) || 'CNY',
    sourceType,
    createdBy
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>(`
    SELECT *
    FROM finance_account_balance_snapshot
    WHERE bank_account_id = ? AND snapshot_date = ? AND source_type = ?
    LIMIT 1
  `, [account.id, snapshotDate, sourceType])

  return { data: row }
})
