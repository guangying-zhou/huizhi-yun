import assert from 'node:assert/strict'
import test from 'node:test'
import { productFeatureLifecycleInput } from '../server/utils/productFeatureLifecycleInput'

const id = '00000000-0000-4000-8000-000000000001'
const base = { expectedRevision: 2, expectedFeatureRevision: 1, reason: '能力核验' }
test('lifecycle commands separate activation evidence from deprecation', () => {
  assert.ok(productFeatureLifecycleInput({ ...base, target: 'active', evidence: { kind: 'legacy', description: '现有能力说明' } }, id))
  assert.ok(productFeatureLifecycleInput({ ...base, target: 'active', evidence: { kind: 'release', releaseBizId: id } }, id))
  assert.ok(productFeatureLifecycleInput({ ...base, target: 'deprecated' }, id))
  for (const change of [{ target: 'candidate' }, { target: 'active' }, { target: 'active', evidence: { kind: 'legacy', description: '' } }, { target: 'active', evidence: { kind: 'release', releaseBizId: 'bad' } }, { target: 'active', evidence: { kind: 'legacy', description: '证据', confirmed_by: 'manager' } }, { target: 'deprecated', evidence: { kind: 'legacy', description: '替换历史' } }, { target: 'deprecated', isManager: true }, { target: 'deprecated', expectedFeatureRevision: 0 }]) assert.equal(productFeatureLifecycleInput({ ...base, ...change }, id), null)
})
