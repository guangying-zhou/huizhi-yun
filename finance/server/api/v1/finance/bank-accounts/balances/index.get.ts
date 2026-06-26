import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler } from 'h3'
import { getPageParams, getStringQuery, likeKeyword, missingSchemaWarning, type ApiListResult } from '../../../../../utils/financeApi'
import { queryRow, queryRows } from '../../../../../utils/db'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'

type BalanceSnapshotListRow = RowDataPacket & {
  id: number
  account_code: string
  account_name: string
  bank_name: string | null
  account_no_masked: string | null
  snapshot_date: string
  balance_amount: string
  currency_code: string
  source_type: string
  created_by: string | null
  created_at: string
}

type SqlParam = string | number | boolean | Date | Buffer | null

export default defineEventHandler(async (event): Promise<ApiListResult<BalanceSnapshotListRow>> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<ApiListResult<BalanceSnapshotListRow>>(event)
  if (runtime.handled) return runtime.data

  const page = getPageParams(event)
  const where: string[] = ['ba.deleted_at IS NULL']
  const params: SqlParam[] = []

  const keyword = getStringQuery(event, 'keyword')
  if (keyword) {
    where.push(`(
      ba.code LIKE ? ESCAPE '\\\\'
      OR ba.account_name LIKE ? ESCAPE '\\\\'
      OR ba.bank_name LIKE ? ESCAPE '\\\\'
      OR ba.account_no_masked LIKE ? ESCAPE '\\\\'
      OR bs.source_type LIKE ? ESCAPE '\\\\'
      OR bs.created_by LIKE ? ESCAPE '\\\\'
    )`)
    params.push(...Array.from({ length: 6 }, () => likeKeyword(keyword)))
  }

  const accountCode = getStringQuery(event, 'account_code')
  if (accountCode) {
    where.push('ba.code = ?')
    params.push(accountCode)
  }

  const dateFrom = getStringQuery(event, 'dateFrom')
  if (dateFrom) {
    where.push('bs.snapshot_date >= ?')
    params.push(dateFrom)
  }

  const dateTo = getStringQuery(event, 'dateTo')
  if (dateTo) {
    where.push('bs.snapshot_date <= ?')
    params.push(dateTo)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  try {
    const count = await queryRow<RowDataPacket & { total: number }>(`
      SELECT COUNT(*) AS total
      FROM finance_account_balance_snapshot bs
      JOIN finance_bank_account ba ON ba.id = bs.bank_account_id
      ${whereSql}
    `, params)
    const rows = await queryRows<BalanceSnapshotListRow[]>(`
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
      ${whereSql}
      ORDER BY bs.snapshot_date DESC, bs.id DESC
      LIMIT ? OFFSET ?
    `, [...params, page.pageSize, page.offset])

    return {
      data: rows,
      total: Number(count?.total || 0),
      page: page.page,
      pageSize: page.pageSize
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      data: [],
      total: 0,
      page: page.page,
      pageSize: page.pageSize,
      warning
    }
  }
})
