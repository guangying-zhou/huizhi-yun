import test from 'node:test'
import assert from 'node:assert/strict'
import { optionalReadPagination } from '../shared/utils/optionalReadPagination'

test('optional read pagination preserves omission and rejects invalid bounds and shapes', () => {
  assert.deepEqual(optionalReadPagination({ type: 'private' }), {})
  assert.deepEqual(optionalReadPagination({ page: '2', pageSize: '100' }), { page: '2', pageSize: '100' })
  for (const value of ['', '0', '-1', '01', '1.5', '1e2', ['1', '2'], 100]) assert.throws(() => optionalReadPagination({ page: value }))
  assert.throws(() => optionalReadPagination({ pageSize: '101' }))
  assert.throws(() => optionalReadPagination({ page: '1000001' }))
})
