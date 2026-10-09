import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productSelectionInput } from '../server/utils/productSelectionInput.ts'

const cycle = '00000000-0000-4000-8000-000000000001'
const item = '00000000-0000-4000-8000-000000000002'
const input = { expectedRevision: 1, expectedCycleRevision: 2, expectedItemRevision: 3, expectedQueueRevision: 4, expectedAssessmentId: 5, reason: '确认本期范围', exceptions: [] }
const exception = { code: 'category_capacity_exceeded', category: 'growth', reason: '明确的投资取舍', responsibleUid: 'pm', impact: '本类超预算 2 人日' }

test('selection binds both path identities and all optimistic versions', () => {
  assert.deepEqual(productSelectionInput(input, cycle, item), { cycle_biz_id: cycle, item_biz_id: item, expected_revision: 1, expected_cycle_revision: 2, expected_item_revision: 3, expected_queue_revision: 4, expected_assessment_id: 5, reason: input.reason, exceptions: [] })
  for (const key of ['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedQueueRevision', 'expectedAssessmentId']) {
    for (const value of [null, undefined, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(productSelectionInput({ ...input, [key]: value }, cycle, item), null)
  }
  for (const extra of [{ itemId: cycle }, { cycleId: item }, { actor: 'admin' }, { score: 100 }, { selectionStatus: 'selected' }, { snapshot: {} }]) assert.equal(productSelectionInput({ ...input, ...extra }, cycle, item), null)
  assert.equal(productSelectionInput(input, 'invalid', item), null)
  assert.equal(productSelectionInput(input, cycle, 'invalid'), null)
})

test('selection exceptions require explicit specific issues and preserve evidence text', () => {
  const result = productSelectionInput({ ...input, exceptions: [exception] }, cycle, item)
  assert.deepEqual(result?.exceptions, [{ code: exception.code, category: 'growth', reason: exception.reason, responsible_uid: 'pm', impact: exception.impact }])
  for (const patch of [{ code: 'assessment_required' }, { code: 'override' }, { category: 'other' }, { itemId: item }, { reason: '' }, { impact: '\uD800' }, { responsibleUid: ' pm ' }, { actor: 'admin' }]) assert.equal(productSelectionInput({ ...input, exceptions: [{ ...exception, ...patch }] }, cycle, item), null)
  for (const exceptions of [null, undefined, true, {}, [exception, exception], Array(101).fill(exception)]) assert.equal(productSelectionInput({ ...input, exceptions }, cycle, item), null)
  const dependency = { code: 'dependency_unresolved', itemId: item, predecessorId: cycle, reason: '并行处理', responsibleUid: 'tech', impact: '前置仍未解除' }
  assert.equal(productSelectionInput({ ...input, exceptions: [dependency] }, cycle, item)?.exceptions[0]?.predecessor_id, cycle)
  assert.equal(productSelectionInput({ ...input, exceptions: [{ ...dependency, predecessorId: item }] }, cycle, item), null)
})
