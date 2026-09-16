import assert from 'node:assert/strict'
import test from 'node:test'
import { productVersionScopeInput, productVersionScopePageInput, productVersionScopeDeliveryInput } from '../server/utils/productVersionScopeInput'

test('scope input binds version and requires current planning decision revisions', () => {
  const draft = { itemBizId: '00000000-0000-4000-8000-000000000001', cycleBizId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1, expectedItemRevision: 1, expectedCycleRevision: 1, expectedQueueRevision: 1, expectedVersionRevision: 1, title: '范围', acceptanceCriteria: '验收依据', changeType: 'new', reason: '正式安排' }
  assert.equal(productVersionScopeInput(draft, 7)?.version_id, 7)
  const source = { versionId: 6, scopeId: 3, expectedVersionRevision: 2, expectedScopeRevision: 1 }
  assert.equal(productVersionScopeInput({ ...draft, deferredFrom: source }, 7), null)
  assert.equal(productVersionScopeInput({ ...draft, deferredFrom: source }, 7, true)?.deferred_from?.scope_id, 3)
  for (const deferredFrom of [null, {}, [], { ...source, versionId: 7 }, { ...source, scopeId: '3' }, { ...source, expectedScopeRevision: 0 }, { ...source, actorUid: 'admin' }]) assert.equal(productVersionScopeInput({ ...draft, deferredFrom }, 7, true), null)
  for (const extra of [{ versionId: 8 }, { productCode: 'OTHER' }, { status: 'delivered' }, { productFeatureId: 1 }, { expectedQueueRevision: 0 }, { expectedVersionRevision: '1' }, { acceptanceCriteria: '' }, { title: '字'.repeat(256) }, { reason: '' }, { itemBizId: '1' }, { changeType: 'unknown' }]) assert.equal(productVersionScopeInput({ ...draft, ...extra }, 7), null)
})
test('scope list supports bounded literal search and rejects extra filters', () => {
  assert.equal(productVersionScopePageInput({ page: '2', pageSize: '20', keyword: '%_' })?.page, 2)
  for (const query of [{ status: 'planned' }, { page: '0' }, { pageSize: '101' }, { keyword: ['a', 'b'] }]) assert.equal(productVersionScopePageInput(query), null)
})

test('scope delivery requires explicit evidence and immutable path identity', () => {
  const draft = { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 2, evidence: '测试记录 TR-01', reason: '完成清单核对' }
  assert.equal(productVersionScopeDeliveryInput(draft, 1, 2)?.scope_id, 2)
  for (const extra of [{ evidence: '' }, { reason: ' ' }, { acceptedBy: 'other' }, { scopeId: 3 }, { status: 'delivered' }, { expectedScopeRevision: 0 }, { expectedRevision: '3' }]) assert.equal(productVersionScopeDeliveryInput({ ...draft, ...extra }, 1, 2), null)
})
