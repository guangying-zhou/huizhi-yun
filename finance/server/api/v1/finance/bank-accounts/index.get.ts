import { defineEventHandler } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { getStringQuery, likeKeyword, missingSchemaWarning, type ApiListResult } from '../../../../utils/financeApi'
import { queryRow, queryRows } from '../../../../utils/db'
import { maybeCallFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { FinanceRow } from '../../../../types/finance'

type BankAccountRow = FinanceRow & RowDataPacket & {
  latest_balance_amount: string | null
  latest_balance_date: string | null
}

type BankAccountSummary = {
  account_count: number
  cash_balance: string
  loan_balance: string
  stock_fund_balance: string
}

type BankAccountListResult = ApiListResult<BankAccountRow> & {
  summary: BankAccountSummary
}

type SqlParam = string | number | boolean | Date | Buffer | null

export default defineEventHandler(async (event): Promise<BankAccountListResult> => {
  const runtime = await maybeCallFinanceDataRuntime<BankAccountListResult>(
    event,
    '/v1/finance/bank-accounts',
    { scope: 'finance.bank_accounts.read' }
  )
  if (runtime.handled) return runtime.data

  const where: string[] = ['ba.deleted_at IS NULL']
  const params: SqlParam[] = []
  const showAll = isTruthy(getStringQuery(event, 'showAll'))

  if (!showAll) {
    where.push('ba.status = ?')
    params.push('active')
    where.push('COALESCE(latest.balance_amount, 0) <> 0')
  }

  const keyword = getStringQuery(event, 'keyword')
  if (keyword) {
    where.push('(ba.code LIKE ? ESCAPE \'\\\\\' OR ba.account_name LIKE ? ESCAPE \'\\\\\' OR ba.bank_name LIKE ? ESCAPE \'\\\\\' OR ba.account_no_masked LIKE ? ESCAPE \'\\\\\' OR ba.owner_dept_code LIKE ? ESCAPE \'\\\\\')')
    params.push(...Array.from({ length: 5 }, () => likeKeyword(keyword)))
  }

  const status = getStringQuery(event, 'status')
  if (status) {
    where.push('ba.status = ?')
    params.push(status)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const fromSql = `
    FROM finance_bank_account ba
    LEFT JOIN finance_account_balance_snapshot latest
      ON latest.id = (
        SELECT bs.id
        FROM finance_account_balance_snapshot bs
        WHERE bs.bank_account_id = ba.id
        ORDER BY bs.snapshot_date DESC, bs.id DESC
        LIMIT 1
      )
  `

  try {
    const count = await queryRow<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total ${fromSql} ${whereSql}`,
      params
    )
    const summary = await queryRow<RowDataPacket & BankAccountSummary>(`
      SELECT
        COUNT(*) AS account_count,
        COALESCE(SUM(CASE WHEN latest.balance_amount > 0 THEN latest.balance_amount ELSE 0 END), 0) AS cash_balance,
        COALESCE(SUM(CASE WHEN latest.balance_amount < 0 THEN latest.balance_amount ELSE 0 END), 0) AS loan_balance,
        COALESCE(SUM(CASE WHEN latest.balance_amount <> 0 THEN latest.balance_amount ELSE 0 END), 0) AS stock_fund_balance
      ${fromSql}
      ${whereSql}
    `, params)
    const rows = await queryRows<BankAccountRow[]>(`
      SELECT
        ba.id,
        ba.code,
        ba.account_name,
        ba.bank_name,
        ba.account_no_masked,
        ba.account_type,
        ba.currency_code,
        ba.owner_dept_code,
        ba.status,
        ba.opened_at,
        ba.created_at,
        ba.deleted_at,
        latest.balance_amount AS latest_balance_amount,
        latest.snapshot_date AS latest_balance_date
      ${fromSql}
      ${whereSql}
      ORDER BY latest.snapshot_date DESC, ba.created_at DESC, ba.id DESC
    `, params)

    return {
      data: rows,
      summary: {
        account_count: Number(summary?.account_count || 0),
        cash_balance: String(summary?.cash_balance || '0.00'),
        loan_balance: String(summary?.loan_balance || '0.00'),
        stock_fund_balance: String(summary?.stock_fund_balance || '0.00')
      },
      total: Number(count?.total || 0),
      page: 1,
      pageSize: Number(count?.total || 0)
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      data: [],
      summary: {
        account_count: 0,
        cash_balance: '0.00',
        loan_balance: '0.00',
        stock_fund_balance: '0.00'
      },
      total: 0,
      page: 1,
      pageSize: 0,
      warning
    }
  }
})

function isTruthy(value: string): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}
