import { defineEventHandler } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { getStringQuery, missingSchemaWarning, type ApiListResult } from '../../../../../utils/financeApi'
import { queryRows } from '../../../../../utils/db'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'

type BalanceChangeRange = 'current_year' | 'current_month' | 'last_1_month' | 'last_3_months' | 'last_6_months'

type BalanceSnapshotRow = RowDataPacket & {
  bank_account_id: number
  snapshot_date: string
  balance_amount: string
}

type BalanceChangeRow = {
  balance_date: string
  previous_total_balance: string
  change_amount: string
  total_balance: string
  direction: 'increase' | 'decrease' | 'flat'
}

type BalanceChangeSummary = {
  opening_balance: string
  closing_balance: string
  net_change: string
}

type BalanceChangeResult = ApiListResult<BalanceChangeRow> & {
  chartData: BalanceChangeRow[]
  range: BalanceChangeRange
  summary: BalanceChangeSummary
}

const supportedRanges = new Set<BalanceChangeRange>([
  'current_year',
  'current_month',
  'last_1_month',
  'last_3_months',
  'last_6_months'
])

export default defineEventHandler(async (event): Promise<BalanceChangeResult> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<BalanceChangeResult>(event)
  if (runtime.handled) return runtime.data

  const range = normalizeRange(getStringQuery(event, 'range'))
  const { startDate, endDate } = getDateWindow(range)

  try {
    const snapshots = await queryRows<BalanceSnapshotRow[]>(`
      SELECT
        ba.id AS bank_account_id,
        bs.snapshot_date,
        bs.balance_amount
      FROM finance_bank_account ba
      JOIN finance_account_balance_snapshot bs ON bs.bank_account_id = ba.id
      WHERE ba.deleted_at IS NULL
        AND bs.snapshot_date <= ?
      ORDER BY bs.snapshot_date ASC, bs.id ASC
    `, [endDate])
    const rows = buildBalanceChanges(snapshots, startDate, endDate)
    const openingBalance = rows[0]?.previous_total_balance || calculateOpeningBalance(snapshots, startDate)
    const closingBalance = rows[rows.length - 1]?.total_balance || openingBalance
    const netChange = formatAmount(Number(closingBalance) - Number(openingBalance))

    return {
      data: rows,
      chartData: rows,
      range,
      summary: {
        opening_balance: openingBalance,
        closing_balance: closingBalance,
        net_change: netChange
      },
      total: rows.length,
      page: 1,
      pageSize: rows.length
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      data: [],
      chartData: [],
      range,
      summary: {
        opening_balance: '0.00',
        closing_balance: '0.00',
        net_change: '0.00'
      },
      total: 0,
      page: 1,
      pageSize: 0,
      warning
    }
  }
})

function normalizeRange(value: string): BalanceChangeRange {
  return supportedRanges.has(value as BalanceChangeRange) ? value as BalanceChangeRange : 'current_year'
}

function getDateWindow(range: BalanceChangeRange) {
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = new Date(end)

  if (range === 'current_year') {
    start.setMonth(0, 1)
  } else if (range === 'current_month') {
    start.setDate(1)
  } else if (range === 'last_1_month') {
    start.setMonth(start.getMonth() - 1)
  } else if (range === 'last_3_months') {
    start.setMonth(start.getMonth() - 3)
  } else if (range === 'last_6_months') {
    start.setMonth(start.getMonth() - 6)
  }

  return {
    startDate: toDateString(start),
    endDate: toDateString(end)
  }
}

function buildBalanceChanges(snapshots: BalanceSnapshotRow[], startDate: string, endDate: string): BalanceChangeRow[] {
  const balances = new Map<number, number>()
  const inRangeSnapshots = new Map<string, Map<number, number>>()

  for (const snapshot of snapshots) {
    const date = formatSnapshotDate(snapshot.snapshot_date)
    const amount = Number(snapshot.balance_amount || 0)
    if (!Number.isFinite(amount)) continue

    if (date < startDate) {
      balances.set(Number(snapshot.bank_account_id), amount)
      continue
    }
    if (date > endDate) continue

    const dailySnapshots = inRangeSnapshots.get(date) || new Map<number, number>()
    dailySnapshots.set(Number(snapshot.bank_account_id), amount)
    inRangeSnapshots.set(date, dailySnapshots)
  }

  return [...inRangeSnapshots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dailySnapshots]) => {
      const previousTotal = sumBalances(balances)
      for (const [accountId, amount] of dailySnapshots.entries()) {
        balances.set(accountId, amount)
      }
      const totalBalance = sumBalances(balances)
      const changeAmount = totalBalance - previousTotal

      return {
        balance_date: date,
        previous_total_balance: formatAmount(previousTotal),
        change_amount: formatAmount(changeAmount),
        total_balance: formatAmount(totalBalance),
        direction: changeAmount > 0 ? 'increase' : changeAmount < 0 ? 'decrease' : 'flat'
      }
    })
}

function calculateOpeningBalance(snapshots: BalanceSnapshotRow[], startDate: string): string {
  const balances = new Map<number, number>()
  for (const snapshot of snapshots) {
    const date = formatSnapshotDate(snapshot.snapshot_date)
    const amount = Number(snapshot.balance_amount || 0)
    if (!Number.isFinite(amount) || date >= startDate) continue
    balances.set(Number(snapshot.bank_account_id), amount)
  }
  return formatAmount(sumBalances(balances))
}

function sumBalances(balances: Map<number, number>): number {
  return [...balances.values()].reduce((sum, amount) => sum + amount, 0)
}

function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatSnapshotDate(value: string): string {
  return String(value || '').slice(0, 10)
}

function formatAmount(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2)
}
