import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildBalanceChart,
  buildWaterfallChart,
  formatAxisMoney,
  formatPlainMoney,
  formatSignedMoney,
  type BalanceChangeRow,
  type BalanceSnapshotRow
} from '../app/utils/bankAccountCharts.ts'

describe('bank account chart builders', () => {
  test('builds a stable balance line for a single snapshot', () => {
    const snapshots: BalanceSnapshotRow[] = [{
      id: 1,
      snapshot_date: '2026-07-12T00:00:00.000Z',
      balance_amount: '12500',
      currency_code: 'CNY',
      source_type: 'manual',
      created_by: null,
      created_at: '2026-07-12T00:00:00.000Z'
    }]

    const chart = buildBalanceChart(snapshots)

    assert.equal(chart.points, '28.0,196.0')
    assert.equal(chart.latest?.date, '2026-07-12')
    assert.equal(chart.latest?.amount, 12500)
    assert.equal(chart.labels.length, 1)
  })

  test('builds responsive waterfall geometry and preserves direction', () => {
    const changes: BalanceChangeRow[] = [{
      balance_date: '2026-07-11',
      previous_total_balance: '100',
      change_amount: '40',
      total_balance: '140',
      direction: 'increase'
    }]

    const chart = buildWaterfallChart(changes, 500)

    assert.equal(chart.width, 760)
    assert.equal(chart.bars.length, 1)
    assert.equal(chart.bars[0]?.direction, 'increase')
    assert.equal(chart.bars[0]?.change, 40)
  })

  test('returns empty chart contracts when no values are available', () => {
    assert.equal(buildBalanceChart([]).points, '')
    assert.deepEqual(buildWaterfallChart([], 1200).bars, [])
  })

  test('formats chart values consistently', () => {
    assert.equal(formatPlainMoney(12500), '12,500.00')
    assert.equal(formatSignedMoney(-12500), '-12,500.00')
    assert.equal(formatAxisMoney(12500), '1万')
  })
})
