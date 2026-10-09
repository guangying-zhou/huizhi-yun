import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productPlanningCreateInput, productPlanningPageInput, productPlanningEditInput } from '../server/utils/productPlanningInput.ts'

const draft = { expectedRevision: 1, title: '增加 OIDC', scopeSummary: '本次范围', investmentCategory: 'usability' }
const source = { bizId: '00000000-0000-4000-8000-000000000001', revision: 1 }
test('planning drafts preserve bounded explicit sources and reject forged decisions', () => {
  assert.deepEqual(productPlanningCreateInput(draft)?.requests, [])
  assert.equal(productPlanningCreateInput({ ...draft, requests: [source] })?.requests[0]?.biz_id, source.bizId)
  for (const patch of [{ score: 99 }, { lifecycle: 'delivered' }, { actor: 'admin' }, { expectedRevision: '1' }, { scopeSummary: '\uD800' }, { requests: [source, source] }, { requests: [{ ...source, revision: 0 }] }, { requests: [{ ...source, productCode: 'other' }] }, { investmentCategory: 'unknown' }]) assert.equal(productPlanningCreateInput({ ...draft, ...patch }), null)
})
test('planning filters reject unbounded and unknown query fields', () => {
  assert.equal(productPlanningPageInput({ keyword: '%_' })?.keyword, '%_')
  for (const query of [{ pageSize: '101' }, { page: '0' }, { lifecycle: 'accepted' }, { actor: 'admin' }, { keyword: ['x'] }]) assert.equal(productPlanningPageInput(query), null)
})

test('planning edits require an explicit source set, item version and reason', () => {
  const id = source.bizId
  const edit = { ...draft, urgencyLevel: 'P2', requests: [], expectedItemRevision: 1, reason: '范围调整' }
  assert.equal(productPlanningEditInput(edit, id)?.expected_item_revision, 1)
  for (const patch of [{ requests: undefined }, { expectedItemRevision: 0 }, { reason: '' }, { impactNote: null }, { score: 90 }]) {
    assert.equal(productPlanningEditInput({ ...edit, ...patch }, id), null)
  }
  assert.equal(productPlanningEditInput({ ...draft, expectedItemRevision: 1, reason: '原因' }, id), null)
})
