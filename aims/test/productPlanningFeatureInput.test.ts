import assert from 'node:assert/strict'
import test from 'node:test'
import { productPlanningFeatureInput } from '../server/utils/productPlanningFeatureInput'

const id = '00000000-0000-4000-8000-000000000001'
test('planning feature mutation binds three versions and explicit operation', () => {
  const input = { featureBizId: id, expectedRevision: 1, expectedItemRevision: 1, expectedFeatureRevision: 1, operation: 'link', reason: '能力归属', impactNote: '范围需重新确认' }
  assert.equal(productPlanningFeatureInput(input, id)?.item_biz_id, id)
  for (const change of [{ itemBizId: id }, { featureBizId: 'bad' }, { expectedRevision: 0 }, { expectedItemRevision: 0 }, { expectedFeatureRevision: 0 }, { operation: 'replace' }, { reason: '' }, { impactNote: '\0' }, { impactNote: '\ud800' }, { force: true }]) assert.equal(productPlanningFeatureInput({ ...input, ...change }, id), null)
  assert.equal(productPlanningFeatureInput(input, 'bad'), null)
  assert.equal(productPlanningFeatureInput({ ...input, operation: 'unlink' }, id)?.operation, 'unlink')
})
