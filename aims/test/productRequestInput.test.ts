import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productRequestCreateInput, productRequestPageInput, productRequestEditInput, productRequestDecisionInput } from '../server/utils/productRequestInput.ts'

const draft = { expectedRevision: 1, title: '统一登录', problemStatement: '用户在多个应用间重复登录' }
test('request creation defaults collection fields without manufacturing a decision', () => {
  assert.deepEqual(productRequestCreateInput(draft), { expected_revision: 1, title: draft.title, problem_statement: draft.problemStatement, source_type: 'internal', urgency_level: 'P2' })
  for (const extra of [{ decisionStatus: 'accepted' }, { decidedBy: 'admin' }, { actorUid: 'admin' }, { productCode: 'OTHER' }, { mergedIntoId: 3 }, { authorization: {} }, { priorityScore: 100 }]) {
    assert.equal(productRequestCreateInput({ ...draft, ...extra }), null)
  }
})
test('request collection validates Unicode boundaries and exact enums', () => {
  assert.ok(productRequestCreateInput({ ...draft, title: '字'.repeat(500), problemStatement: '字'.repeat(10000) }))
  for (const patch of [{ title: '字'.repeat(501) }, { title: ' ' }, { title: '\uD800' }, { title: 'bad\0title' }, { problemStatement: '' }, { problemStatement: '字'.repeat(10001) }, { expectedRevision: 0 }, { expectedRevision: '1' }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { sourceType: null }, { urgencyLevel: null }, { sourceType: 'project' }, { urgencyLevel: 'critical' }]) {
    assert.equal(productRequestCreateInput({ ...draft, ...patch }), null)
  }
  for (const urgencyLevel of ['P0', 'P1', 'P2', 'P3']) assert.ok(productRequestCreateInput({ ...draft, urgencyLevel }))
})

test('request module ownership is explicit and list filters stay mutually exclusive', () => {
  assert.equal(productRequestCreateInput({ ...draft, componentId: 42 })?.component_id, 42)
  assert.equal(productRequestCreateInput({ ...draft, componentId: null })?.component_id, null)
  assert.equal(productRequestCreateInput({ ...draft, componentId: 0 }), null)
  assert.equal(productRequestPageInput({ componentId: '42', includeDescendants: 'true' })?.component_id, 42)
  for (const query of [{ includeDescendants: 'true' }, { componentId: '42', unassigned: 'true' }, { componentId: '42', includeDescendants: 'yes' }, { unassigned: '1' }]) assert.equal(productRequestPageInput(query), null)
})

test('request queries accept bounded exact filters and literal search text', () => {
  assert.deepEqual(productRequestPageInput({}), { page: 1, page_size: 20, keyword: '', decision_status: '', source_type: '', urgency_level: '', unassigned: false, include_descendants: false })
  assert.ok(productRequestPageInput({ page: '2', pageSize: '100', keyword: '%_', decisionStatus: 'merged', sourceType: 'engineering', urgencyLevel: 'P0' }))
  for (const query of [{ page: '0' }, { page: '1000001' }, { page: ['1', '2'] }, { pageSize: '101' }, { keyword: null }, { keyword: '\uD800' }, { keyword: '字'.repeat(201) }, { decisionStatus: 'released' }, { sourceType: null }, { urgencyLevel: 'high' }, { actorUid: 'admin' }]) assert.equal(productRequestPageInput(query), null)
})

test('request editing requires explicit fields and both revisions without accepting decision changes', () => {
  const id = 'b5eb7544-0695-4dc1-bc60-107d3e204742'
  const edit = { ...draft, sourceType: 'customer', urgencyLevel: 'P1', expectedRequestRevision: 2, reason: '补充事实' }
  assert.equal(productRequestEditInput(edit, id)?.expected_request_revision, 2)
  assert.equal(productRequestEditInput({ ...edit, componentId: null }, id)?.component_id, 0)
  assert.equal(productRequestEditInput({ ...edit, componentId: 7 }, id)?.component_id, 7)
  assert.equal(productRequestEditInput(edit, '1'), null)
  for (const patch of [{ sourceType: undefined }, { urgencyLevel: undefined }, { expectedRequestRevision: 0 }, { expectedRequestRevision: '2' }, { reason: ' ' }, { reason: '\uD800' }, { reason: '字'.repeat(2001) }, { decisionStatus: 'accepted' }, { biz_id: id }, { actorUid: 'admin' }]) assert.equal(productRequestEditInput({ ...edit, ...patch }, id), null)
})

test('request decisions accept only decisions and trusted route identity', () => {
  const id = 'b5eb7544-0695-4dc1-bc60-107d3e204742'
  const decision = { expectedRevision: 3, expectedRequestRevision: 2, status: 'evaluating' }
  assert.deepEqual(productRequestDecisionInput(decision, id), { biz_id: id, expected_revision: 3, expected_request_revision: 2, status: 'evaluating', reason: '', impact_note: '' })
  for (const patch of [{ status: 'merged' }, { status: 'submitted' }, { status: null }, { expectedRevision: '3' }, { expectedRequestRevision: 0 }, { reason: null }, { reason: '\uD800' }, { impactNote: '字'.repeat(2001) }, { decidedBy: 'admin' }, { authorization: {} }, { title: 'changed' }]) assert.equal(productRequestDecisionInput({ ...decision, ...patch }, id), null)
  assert.equal(productRequestDecisionInput(decision, '1'), null)
})

test('merge source query requires canonical target UUID and rejects numeric internal ids', () => {
  const target = '00000000-0000-4000-8000-000000000001'
  assert.equal(productRequestPageInput({ mergedInto: target })?.merged_into_biz_id, target)
  for (const mergedInto of ['', '1', 1, null, [target]]) assert.equal(productRequestPageInput({ mergedInto }), null)
})
