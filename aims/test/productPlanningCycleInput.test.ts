import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productPlanningCyclePageInput, productPlanningCycleCreateInput, productPlanningCycleEditInput, productPlanningCycleMetricInput, productPlanningCycleTransitionInput, productPlanningCandidatePageInput, productPlanningCandidateAddInput, productPlanningMatrixInput, productPlanningCapacityInput } from '../server/utils/productPlanningCycleInput.ts'

test('cycle queries preserve literal search and bounded pagination', () => {
  assert.deepEqual(productPlanningCyclePageInput({}), { page: 1, page_size: 20, keyword: '', status: '' })
  assert.deepEqual(productPlanningCyclePageInput({ page: '2', pageSize: '100', keyword: '%_', status: 'closed' }), { page: 2, page_size: 100, keyword: '%_', status: 'closed' })
  for (const query of [{ page: '0' }, { page: '1000001' }, { page: '1e2' }, { page: ['1', '2'] }, { pageSize: '101' }, { pageSize: 20 }, { status: 'active' }, { keyword: ['a'] }, { keyword: '\uD800' }, { keyword: '\0' }, { keyword: '界'.repeat(201) }, { actor: 'admin' }, { productCode: 'another' }]) {
    assert.equal(productPlanningCyclePageInput(query), null, JSON.stringify(query))
  }
})

const draft = { expectedRevision: 1, title: '九月规划', startsOn: '2026-09-01', endsOn: '2026-09-30', goalSummary: '改善首次使用体验' }
const budget = { totalPersonDays: '10.75', reservePersonDays: 1, reliabilityPersonDays: '3.25', usabilityPersonDays: '3.25', growthPersonDays: '3.25' }
test('cycle drafts distinguish unknown budget from explicit zero and preserve exact amounts', () => {
  assert.equal(productPlanningCycleCreateInput(draft)?.budget, null)
  assert.equal(productPlanningCycleCreateInput(draft)?.review_interval_days, 14)
  assert.equal(productPlanningCycleCreateInput({ ...draft, budget })?.budget?.total_person_days, '10.75')
  const zero = Object.fromEntries(Object.keys(budget).map(key => [key, 0]))
  assert.equal(productPlanningCycleCreateInput({ ...draft, budget: zero })?.budget?.total_person_days, '0.00')
  for (const patch of [{ expectedRevision: '1' }, { title: ' ' }, { startsOn: '2026-02-30' }, { endsOn: '2026-08-31' }, { reviewIntervalDays: null }, { reviewIntervalDays: 367 }, { status: 'open' }, { modelVersion: 'custom' }, { actor: 'admin' }, { budget: {} }, { budget: { ...budget, growthPersonDays: 4 } }]) {
    assert.equal(productPlanningCycleCreateInput({ ...draft, ...patch }), null)
  }
  for (const amount of ['1e2', '1.001', -1, Infinity, NaN, true, null, undefined, '1000000.01', ' 1', '']) {
    assert.equal(productPlanningCycleCreateInput({ ...draft, budget: { ...budget, totalPersonDays: amount } }), null, String(amount))
  }
})

test('cycle edits require versions, reason and explicit budget intent', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const edit = { ...draft, expectedCycleRevision: 1, reason: '修改计划', reviewIntervalDays: 7, budgetMode: 'keep' }
  assert.equal(productPlanningCycleEditInput(edit, id)?.budget_mode, 'keep')
  assert.equal(productPlanningCycleEditInput({ ...edit, budgetMode: 'clear' }, id)?.budget, null)
  assert.equal(productPlanningCycleEditInput({ ...edit, budgetMode: 'set', budget }, id)?.budget?.total_person_days, '10.75')
  for (const patch of [{ expectedCycleRevision: 0 }, { expectedCycleRevision: '1' }, { reason: '' }, { budgetMode: undefined }, { budgetMode: 'set' }, { budget }, { budgetMode: 'clear', budget }, { reviewIntervalDays: undefined }, { actor: 'admin' }]) {
    assert.equal(productPlanningCycleEditInput({ ...edit, ...patch }, id), null)
  }
  assert.equal(productPlanningCycleEditInput(edit, 'other'), null)
})

test('cycle metrics preserve exact values and require explicit unknowns', () => {
  const metric = { name: '成功率', unit: '百分比', direction: 'increase', measurementMethod: '按期间内用户去重计算', baselineValue: null, targetValue: '99999999999999.123456' }
  assert.equal(productPlanningCycleMetricInput(metric)?.target_value, metric.targetValue)
  assert.equal(productPlanningCycleCreateInput({ ...draft, metric })?.metric?.baseline_value, null)
  for (const patch of [{ baselineValue: undefined }, { targetValue: undefined }, { targetValue: 12.3 }, { targetValue: '1e2' }, { targetValue: '1.1234567' }, { targetValue: '100000000000000' }, { name: ' ' }, { direction: 'auto' }, { verified: true }]) {
    assert.equal(productPlanningCycleMetricInput({ ...metric, ...patch }), null)
  }
  assert.equal(productPlanningCycleMetricInput({ ...metric, baselineValue: '0' })?.baseline_value, '0')
  assert.equal(productPlanningCycleCreateInput({ ...draft, metric: { ...metric, targetValue: 1 } }), null)
})

test('cycle transitions accept only versions and a decision reason', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const input = { expectedRevision: 2, expectedCycleRevision: 1, reason: '目标与容量确认' }
  assert.equal(productPlanningCycleTransitionInput(input, id)?.biz_id, id)
  for (const patch of [{ reason: '' }, { expectedCycleRevision: '1' }, { expectedRevision: 0 }, { status: 'open' }, { nextReviewAt: '2099-01-01' }, { actor: 'admin' }]) assert.equal(productPlanningCycleTransitionInput({ ...input, ...patch }, id), null)
})

test('cycle candidate query binds path identity and distinct selection state', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(productPlanningCandidatePageInput({ page: '2', pageSize: '10', keyword: '%_', selectionStatus: 'selected' }, id), { cycle_biz_id: id, page: 2, page_size: 10, keyword: '%_', selection_status: 'selected' })
  for (const query of [{ status: 'open' }, { cycleId: 'other' }, { selectionStatus: 'open' }, { selectionStatus: ['candidate'] }, { pageSize: '101' }, { page: '-1' }, { actor: 'admin' }, { keyword: '\uD800' }]) assert.equal(productPlanningCandidatePageInput(query, id), null)
  assert.equal(productPlanningCandidatePageInput({}, 'other'), null)
})

test('candidate additions bind the cycle path and require all three exact revisions', () => {
  const cycle = '00000000-0000-0000-0000-000000000001'
  const item = '00000000-0000-0000-0000-000000000002'
  const body = { itemId: item, expectedRevision: 1, expectedCycleRevision: 2, expectedItemRevision: 3 }
  assert.deepEqual(productPlanningCandidateAddInput(body, cycle), { cycle_biz_id: cycle, item_biz_id: item, expected_revision: 1, expected_cycle_revision: 2, expected_item_revision: 3 })
  for (const key of ['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision']) {
    for (const value of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) assert.equal(productPlanningCandidateAddInput({ ...body, [key]: value }, cycle), null)
  }
  for (const extra of [{ cycleId: item }, { selectionStatus: 'selected' }, { actor: 'admin' }, { score: 100 }]) assert.equal(productPlanningCandidateAddInput({ ...body, ...extra }, cycle), null)
  assert.equal(productPlanningCandidateAddInput({ ...body, itemId: 'invalid' }, cycle), null)
  assert.equal(productPlanningCandidateAddInput(body, 'invalid'), null)
  assert.equal(productPlanningCandidateAddInput([], cycle), null)
})

test('candidate recommendation options are allowlisted and do not accept SQL or empty categories', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assert.equal(productPlanningCandidatePageInput({ sort: 'recommended', investmentCategory: 'growth' }, id)?.sort, 'recommended')
  for (const query of [{ sort: 'score DESC' }, { sort: ['decision'] }, { investmentCategory: '' }, { investmentCategory: 'other' }, { investmentCategory: ['growth'] }]) assert.equal(productPlanningCandidatePageInput(query, id), null)
})

test('matrix filters cannot override the server bound, pagination or path identity', () => {
  const cycle = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(productPlanningMatrixInput({ keyword: '%_', investmentCategory: 'growth', selectionStatus: 'selected' }, cycle), { cycle_biz_id: cycle, keyword: '%_', selection_status: 'selected', investment_category: 'growth' })
  for (const query of [{ limit: '1000' }, { page: '2' }, { pageSize: '1000' }, { sort: 'recommended' }, { cycleId: cycle }, { actor: 'admin' }, { keyword: ['a'] }, { investmentCategory: 'unknown' }]) assert.equal(productPlanningMatrixInput(query, cycle), null)
  assert.equal(productPlanningMatrixInput({}, 'invalid'), null)
})

test('capacity queries cover the full cycle and reject any subset or identity override', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(productPlanningCapacityInput({}, id), { cycle_biz_id: id })
  for (const query of [{ page: '1' }, { keyword: 'one' }, { investmentCategory: 'growth' }, { selectionStatus: 'selected' }, { cycleId: id }, { current_user: 'admin' }]) assert.equal(productPlanningCapacityInput(query, id), null)
  assert.equal(productPlanningCapacityInput({}, 'invalid'), null)
})

test('review due filter accepts only explicit query booleans', () => {
  assert.equal(productPlanningCyclePageInput({ reviewDue: 'true' })?.review_due, true)
  for (const reviewDue of [true, 1, '1', ['true'], '']) assert.equal(productPlanningCyclePageInput({ reviewDue }), null)
})
