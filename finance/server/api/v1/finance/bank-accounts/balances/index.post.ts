import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { cleanString, moneyString, optionalDate, requiredString, type SqlParam } from '../../../../../utils/financeWrite'
import { getRequestUid } from '../../../../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const accountCode = requiredString(body.accountCode ?? body.account_code, 'accountCode')
  const account = await queryRow<RowDataPacket & { id: number }>(
    'SELECT id FROM finance_bank_account WHERE code = ? AND deleted_at IS NULL',
    [accountCode]
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
    SELECT
      bs.id,
      ba.code AS account_code,
      ba.account_name,
      ba.bank_name,
      ba.account_no_masked,
      bs.snapshot_date,
      bs.balance_amount,
      bs.currency_code,
      bs.source_type,
      bs.created_by,
      bs.created_at
    FROM finance_account_balance_snapshot bs
    JOIN finance_bank_account ba ON ba.id = bs.bank_account_id
    WHERE bs.bank_account_id = ? AND bs.snapshot_date = ? AND bs.source_type = ?
    LIMIT 1
  `, [account.id, snapshotDate, sourceType])

  return { data: row }
})
