import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productListInput } from '../server/utils/productListInput.ts'

test('product list query is bounded and cannot accept scope injection', () => {
  assert.deepEqual(productListInput({}), { page: 1, page_size: 20, keyword: '', product_line: '', status: '' })
  for (const query of [{ pageSize: '101' }, { page: '0' }, { page: ['1'] }, { status: 'deleted' }, { scope: 'global' }, { productLine: ['software'] }]) assert.equal(productListInput(query), null)
})

test('unified list accepts pending, active and archived filters', () => {
  for (const status of ['not_enabled', 'active', 'archived']) {
    assert.equal(productListInput({ status })?.status, status)
  }
})
