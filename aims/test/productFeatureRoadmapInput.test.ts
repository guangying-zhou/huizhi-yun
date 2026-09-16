import assert from 'node:assert/strict'
import test from 'node:test'
import { productFeatureRoadmapInput } from '../server/utils/productFeatureRoadmapInput'

const id = '00000000-0000-4000-8000-000000000001'
test('feature roadmap binds cycle and feature with bounded pagination', () => {
  assert.deepEqual(productFeatureRoadmapInput({ cycleId: id }, id), { feature_biz_id: id, cycle_biz_id: id, page: 1, page_size: 20 })
  for (const query of [{}, { cycleId: 'bad' }, { cycleId: [id] }, { cycleId: id, pageSize: '101' }, { cycleId: id, page: '0' }, { cycleId: id, featureId: id }, { cycleId: id, keyword: 'unrelated' }]) assert.equal(productFeatureRoadmapInput(query, id), null)
  assert.equal(productFeatureRoadmapInput({ cycleId: id }, 'bad'), null)
})
