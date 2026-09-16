import assert from 'node:assert/strict'
import test from 'node:test'
import { productFeatureComponentInput, productFeatureCreateInput, productFeatureDeleteInput, productFeatureEditInput, productFeaturePageInput } from '../server/utils/productFeatureInput'

test('feature creation accepts candidate content only and validates text', () => {
  const valid = { expectedRevision: 1, title: '统一登录' }
  assert.deepEqual(productFeatureCreateInput(valid), { expected_revision: 1, title: '统一登录', description: '' })
  for (const change of [{ lifecycle: 'active' }, { projectId: 1 }, { title: ' ' }, { title: '\ud800' }, { description: '\0' }, { description: null }, { expectedRevision: 0 }, { description: '字'.repeat(10001) }]) {
    assert.equal(productFeatureCreateInput({ ...valid, ...change }), null)
  }
})

test('feature lists reject unbounded pagination and unrelated filters', () => {
  assert.deepEqual(productFeaturePageInput({ keyword: '%_', lifecycle: 'candidate' }), { page: 1, page_size: 20, keyword: '%_', lifecycle: 'candidate' })
  for (const query of [{ pageSize: '101' }, { page: '-1' }, { lifecycle: 'released' }, { lifecycle: ['active'] }, { keyword: '\ud800' }, { decisionStatus: 'accepted' }]) assert.equal(productFeaturePageInput(query), null)
})

test('feature editing binds identity and versions and requires a reason', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const valid = { expectedRevision: 2, expectedFeatureRevision: 1, title: '功能', description: '补充说明', reason: '修正用语' }
  assert.equal(productFeatureEditInput(valid, id)?.expected_feature_revision, 1)
  for (const change of [{ expectedFeatureRevision: 0 }, { reason: '' }, { reason: '\0' }, { lifecycle: 'active' }, { expectedRevision: 0 }]) assert.equal(productFeatureEditInput({ ...valid, ...change }, id), null)
  assert.equal(productFeatureEditInput(valid, 'other'), null)
})

test('feature deletion requires exact identity, versions and reason without client state', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const valid = { expectedRevision: 2, expectedFeatureRevision: 1, reason: '重复候选' }
  assert.equal(productFeatureDeleteInput(valid, id)?.biz_id, id)
  for (const change of [{ expectedRevision: 0 }, { expectedFeatureRevision: 0 }, { reason: '' }, { reason: '\0' }, { force: true }, { lifecycle: 'candidate' }, { references: 0 }, { title: '伪造快照' }]) assert.equal(productFeatureDeleteInput({ ...valid, ...change }, id), null)
  assert.equal(productFeatureDeleteInput(valid, 'invalid'), null)
})

test('feature module filters distinguish all, ungrouped and an explicit module', () => {
  assert.equal(productFeaturePageInput({ componentId: '12' })?.component_id, 12)
  assert.equal(productFeaturePageInput({ ungrouped: 'true' })?.ungrouped, true)
  assert.equal(productFeaturePageInput({})?.component_id, undefined)
  for (const query of [{ componentId: '0' }, { componentId: ['12'] }, { componentId: '9007199254740992' }, { ungrouped: 'false' }, { componentId: '12', ungrouped: 'true' }]) assert.equal(productFeaturePageInput(query), null)
})

test('feature classification binds route identity and requires an explicit target or ungrouping', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const body = { componentId: null, expectedRevision: 2, expectedFeatureRevision: 1, reason: '移回未分组' }
  assert.equal(productFeatureComponentInput(body, id)?.component_id, null)
  assert.equal(productFeatureComponentInput({ ...body, componentId: 7 }, id)?.component_id, 7)
  for (const raw of [{ ...body, componentId: undefined }, { ...body, componentId: '7' }, { ...body, biz_id: id }, { ...body, reason: '' }, { ...body, expectedFeatureRevision: 0 }]) assert.equal(productFeatureComponentInput(raw, id), null)
})
