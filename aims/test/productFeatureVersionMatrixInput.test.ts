import test from 'node:test'
import assert from 'node:assert/strict'
import { productFeatureVersionMatrixInput } from '../server/utils/productFeatureVersionMatrixInput'
test('matrix preserves selected version order and rejects unbounded or ambiguous queries', () => {
  assert.deepEqual(productFeatureVersionMatrixInput({ versionIds: '3,1', page: '2', pageSize: '10' }), { version_ids: [3, 1], page: 2, page_size: 10 })
  for (const versionIds of ['', '0', '1,1', '1,', '1, 2', '1,2,3,4,5,6,7,8,9,10,11', ['1', '2']]) assert.equal(productFeatureVersionMatrixInput({ versionIds }), null)
  assert.equal(productFeatureVersionMatrixInput({ versionIds: '1', actor: 'other' }), null)
  assert.equal(productFeatureVersionMatrixInput({ versionIds: '1', pageSize: '101' }), null)
})
