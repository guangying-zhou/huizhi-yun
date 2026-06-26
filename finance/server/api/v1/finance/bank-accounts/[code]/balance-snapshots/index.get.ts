import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getPageParams, getStringQuery, missingSchemaWarning, type ApiListResult } from '../../../../../../utils/financeApi'
import { queryRow, queryRows } from '../../../../../../utils/db'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../../utils/dataRuntime'

type BalanceSnapshotRow = RowDataPacket & {
  id: number
  snapshot_date: string
  balance_amount: string
  currency_code: string
  source_type: string
  created_by: string | null
  created_at: string
}

type BalanceRange = 'current_month' | 'last_30_days' | 'current_year' | 'last_1_year' | 'all'

type BalanceSnapshotListResult = ApiListResult<BalanceSnapshotRow> & {
  chartData: BalanceSnapshotRow[]
  range: BalanceRange
}

type SqlParam = string | number | boolean | Date | Buffer | null

export default defineEventHandler(async (event): Promise<BalanceSnapshotListResult> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<BalanceSnapshotListResult>(event)
  if (runtime.handled) return runtime.data

  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const page = getPageParams(event)
  const range = normalizeRange(getStringQuery(event, 'range'))
  try {
    const account = await queryRow<RowDataPacket & { id: number }>(
      'SELECT id FROM finance_bank_account WHERE code = ? AND deleted_at IS NULL',
      [code]
    )
    if (!account) throw createError({ statusCode: 404, statusMessage: 'bank account not found' })

    const { whereSql, params } = balanceRangeWhere(range)
    const count = await queryRow<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM finance_account_balance_snapshot WHERE bank_account_id = ?${whereSql}`,
      [account.id, ...params]
    )
    const rows = await queryRows<BalanceSnapshotRow[]>(`
      SELECT id, snapshot_date, balance_amount, currency_code, source_type, created_by, created_at
      FROM finance_account_balance_snapshot
      WHERE bank_account_id = ?${whereSql}
      ORDER BY snapshot_date DESC, id DESC
      LIMIT ? OFFSET ?
    `, [account.id, ...params, page.pageSize, page.offset])
    const chartData = await queryRows<BalanceSnapshotRow[]>(`
      SELECT id, snapshot_date, balance_amount, currency_code, source_type, created_by, created_at
      FROM finance_account_balance_snapshot
      WHERE bank_account_id = ?${whereSql}
      ORDER BY snapshot_date ASC, id ASC
      LIMIT 500
    `, [account.id, ...params])

    return {
      data: rows,
      chartData,
      range,
      total: Number(count?.total || 0),
      page: page.page,
      pageSize: page.pageSize
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      data: [],
      chartData: [],
      range,
      total: 0,
      page: page.page,
      pageSize: page.pageSize,
      warning
    }
  }
})

function normalizeRange(value: string): BalanceRange {
  if (value === 'last_30_days' || value === 'current_year' || value === 'last_1_year' || value === 'all') return value
  return 'current_month'
}

function balanceRangeWhere(range: BalanceRange): { whereSql: string, params: SqlParam[] } {
  if (range === 'all') return { whereSql: '', params: [] }

  const today = new Date()
  const start = new Date(today)
  if (range === 'current_month') {
    start.setDate(1)
  } else if (range === 'last_30_days') {
    start.setDate(today.getDate() - 29)
  } else if (range === 'current_year') {
    start.setMonth(0, 1)
  } else {
    start.setFullYear(today.getFullYear() - 1)
    start.setDate(today.getDate() + 1)
  }

  return {
    whereSql: ' AND snapshot_date >= ? AND snapshot_date <= ?',
    params: [formatDate(start), formatDate(today)]
  }
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
