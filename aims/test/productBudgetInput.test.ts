import assert from 'node:assert/strict'
import test from 'node:test'
import { productBudgetInput } from '../server/utils/productBudgetInput.ts'

const id = '00000000-0000-4000-8000-000000000001'
const valid = { expectedRevision: 1, expectedCycleRevision: 2, expectedQueueRevision: 3, reason: '可用投入变化', impactNote: '保留已发生投入', exceptions: [], budget: { totalPersonDays: '12.50', reservePersonDays: '0.50', reliabilityPersonDays: '4', usabilityPersonDays: '4', growthPersonDays: '4' } }
test('budget decisions require complete exact amounts, all versions and explicit exceptions', () => {
  const result = productBudgetInput(valid, id)
  assert.equal(result?.budget.total_person_days, '12.50')
  assert.equal(result?.budget.reserve_person_days, '0.50')
  assert.equal(result?.expected_queue_revision, 3)
  for (const patch of [{ budget: null }, { budget: { ...valid.budget, totalPersonDays: '12.49' } }, { budget: { ...valid.budget, totalPersonDays: '12.501' } }, { budget: { ...valid.budget, growthPersonDays: undefined } }, { expectedQueueRevision: 0 }, { exceptions: undefined }, { impactNote: '' }, { actorUid: 'other' }, { capacitySnapshot: {} }]) assert.equal(productBudgetInput({ ...valid, ...patch }, id), null)
})
test('budget exceptions keep responsibility and cannot waive stale assessment', () => {
  const exception = { code: 'capacity_exceeded', reason: '减少预算', responsibleUid: 'pm', impact: '剩余容量为负' }
  assert.equal(productBudgetInput({ ...valid, exceptions: [exception] }, id)?.exceptions[0]?.responsible_uid, 'pm')
  assert.equal(productBudgetInput({ ...valid, exceptions: [exception, exception] }, id), null)
  assert.equal(productBudgetInput({ ...valid, exceptions: [{ ...exception, code: 'assessment_required' }] }, id), null)
})
