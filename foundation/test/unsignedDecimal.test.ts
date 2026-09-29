import test from 'node:test'
import assert from 'node:assert/strict'
import { isPositiveUint64Decimal } from '../shared/utils/unsignedDecimal'

test('positive uint64 decimal validation is exact without BigInt syntax', () => {
  for (const value of ['1', '7', '9999999999999999999', '18446744073709551615']) {
    assert.equal(isPositiveUint64Decimal(value), true, value)
  }
  for (const value of ['', '0', '00', '01', '-1', '+1', '1.0', '18446744073709551616', '99999999999999999999', '1e3']) {
    assert.equal(isPositiveUint64Decimal(value), false, value)
  }
})
