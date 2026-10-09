import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isReceivablePlanOverdue,
  receivableOverdueDays
} from '../app/utils/receivableOverdue.ts'

/** 生成相对今天偏移 n 天的本地日期字符串（YYYY-MM-DD） */
function localDate(offsetDays: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

describe('isReceivablePlanOverdue', () => {
  test('已收和坏账永不算逾期', () => {
    for (const status of ['received', 'bad_debt']) {
      assert.equal(
        isReceivablePlanOverdue({ status, planned_payment_date: localDate(-90) }),
        false,
        `${status} 不应算逾期`
      )
    }
  })

  test('runtime 已标记 overdue 时无需依赖日期', () => {
    assert.equal(isReceivablePlanOverdue({ status: 'overdue', planned_payment_date: null }), true)
  })

  test('计划日期当天不算逾期', () => {
    assert.equal(isReceivablePlanOverdue({ status: 'to_receive', planned_payment_date: localDate(0) }), false)
  })

  test('计划日期已过但尚未被扫描标记时算逾期', () => {
    assert.equal(isReceivablePlanOverdue({ status: 'to_receive', planned_payment_date: localDate(-1) }), true)
  })

  test('未来日期和缺失日期不算逾期', () => {
    assert.equal(isReceivablePlanOverdue({ status: 'to_receive', planned_payment_date: localDate(5) }), false)
    assert.equal(isReceivablePlanOverdue({ status: 'pending', planned_payment_date: null }), false)
    assert.equal(isReceivablePlanOverdue(null), false)
  })

  test('带时间戳的日期同样按本地日解析', () => {
    assert.equal(
      isReceivablePlanOverdue({ status: 'to_receive', planned_payment_date: `${localDate(0)} 00:00:00` }),
      false
    )
  })
})

describe('receivableOverdueDays', () => {
  test('优先使用 runtime 维护的 overdue_days', () => {
    assert.equal(
      receivableOverdueDays({ status: 'overdue', planned_payment_date: localDate(-3), overdue_days: 42 }),
      42
    )
  })

  test('overdue_days 缺失或为 0 时按计划日期推算', () => {
    assert.equal(
      receivableOverdueDays({ status: 'overdue', planned_payment_date: localDate(-7), overdue_days: 0 }),
      7
    )
    assert.equal(
      receivableOverdueDays({ status: 'to_receive', planned_payment_date: localDate(-15) }),
      15
    )
  })

  test('未逾期返回 0', () => {
    assert.equal(receivableOverdueDays({ status: 'to_receive', planned_payment_date: localDate(0) }), 0)
    assert.equal(receivableOverdueDays({ status: 'to_receive', planned_payment_date: localDate(3) }), 0)
    assert.equal(receivableOverdueDays({ status: 'received', planned_payment_date: localDate(-30) }), 0)
  })

  test('非法 overdue_days 不会污染结果', () => {
    assert.equal(
      receivableOverdueDays({ status: 'overdue', planned_payment_date: localDate(-4), overdue_days: Number.NaN }),
      4
    )
    assert.equal(
      receivableOverdueDays({ status: 'overdue', planned_payment_date: localDate(-4), overdue_days: -9 }),
      4
    )
  })
})
