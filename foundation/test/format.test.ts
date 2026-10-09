import assert from 'node:assert/strict'
import test from 'node:test'
import { formatMoney } from '../app/utils/format.ts'

test('money retains DECIMAL(18,2) precision, including negative snapshots', () => {
  assert.equal(formatMoney('9999999999999999.99'), '¥9,999,999,999,999,999.99')
  assert.equal(formatMoney('-9007199254740993.01', { currency: 'USD', locale: 'en-US' }), '-$9,007,199,254,740,993.01')
  assert.equal(formatMoney(12.5), '¥12.50')
  assert.equal(formatMoney('0.00'), '¥0.00')
  assert.equal(formatMoney(null), '-')
  assert.equal(formatMoney('not-money', { placeholder: '未提供' }), '未提供')
})
