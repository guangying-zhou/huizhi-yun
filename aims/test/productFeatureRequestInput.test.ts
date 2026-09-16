import assert from 'node:assert/strict'
import test from 'node:test'
import { productFeatureRequestChangeInput, productFeatureRequestPageInput } from '../server/utils/productFeatureRequestInput'

const id = '00000000-0000-4000-8000-000000000001'

test('feature relation input binds path and requires three versions and explicit operation', () => {
  const value = { requestBizId: id, expectedRevision: 1, expectedFeatureRevision: 1, expectedRequestRevision: 1, operation: 'link', reason: '需求归集' }
  assert.equal(productFeatureRequestChangeInput(value, id)?.feature_biz_id, id)
  assert.equal(productFeatureRequestChangeInput({ ...value, operation: 'unlink' }, id)?.operation, 'unlink')
  for (const change of [{ featureBizId: id }, { operation: undefined }, { operation: 'replace' }, { expectedRevision: 0 }, { expectedFeatureRevision: 0 }, { expectedRequestRevision: 0 }, { reason: '' }, { reason: '\ud800' }, { requestBizId: 'other' }, { request_authorization: {} }]) assert.equal(productFeatureRequestChangeInput({ ...value, ...change }, id), null)
  assert.equal(productFeatureRequestChangeInput(value, 'bad'), null)
})

test('feature relation list limits pagination and rejects unrelated filters', () => {
  assert.deepEqual(productFeatureRequestPageInput({}, id), { feature_biz_id: id, page: 1, page_size: 20 })
  for (const query of [{ pageSize: '101' }, { page: '0' }, { page: ['1'] }, { keyword: 'anything' }, { featureId: id }]) assert.equal(productFeatureRequestPageInput(query, id), null)
})
