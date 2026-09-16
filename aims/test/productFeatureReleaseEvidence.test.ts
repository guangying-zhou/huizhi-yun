import test from 'node:test'
import assert from 'node:assert/strict'
import { validFeatureReleaseEvidence } from '../app/utils/productFeatureReleaseEvidence'
const included = { record_id: 8, version_id: 2, membership: 'included', scope_id: 3, frozen_status: 'delivered', current: true, withdrawn: false, superseded: false }
test('feature release evidence preserves unknown, absent and withdrawn history', () => {
  for (const value of [null, included, { ...included, current: false, withdrawn: true }, { ...included, membership: 'absent', scope_id: null, frozen_status: null }, { ...included, membership: 'unavailable', scope_id: null, frozen_status: null }]) assert.equal(validFeatureReleaseEvidence(value, 2), true)
})
test('feature release evidence rejects missing, mismatched or contradictory evidence', () => {
  for (const value of [undefined, {}, { ...included, version_id: 9 }, { ...included, record_id: -1 }, { ...included, withdrawn: true }, { ...included, superseded: true }, { ...included, current: undefined }, { ...included, membership: 'absent' }, { ...included, membership: 'unavailable' }, { ...included, scope_id: null }, { ...included, frozen_status: null }, { ...included, frozen_status: 'released' }]) assert.equal(validFeatureReleaseEvidence(value, 2), false)
})
