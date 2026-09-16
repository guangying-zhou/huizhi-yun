import test from 'node:test'
import assert from 'node:assert/strict'
import { validProductAssessmentReceipt as valid } from '../app/utils/productAssessmentReceipt'

const expected = { cycleId: 'cycle', itemId: 'item', workspaceRevision: 8, cycleRevision: 4, queueRevision: 2, rice: true }
const receipt = { code: 0, data: { receipt_id: 10, replayed: false, value: { assessment_id: 1, cycle_biz_id: 'cycle', item_biz_id: 'item', workspace_revision: 9, cycle_revision: 5, queue_revision: 2, score: { value_score: null, priority_score: '90.00000000', missing: [] } } } }
test('assessment receipt accepts actual first save and replay, including unknown RICE', () => {
  assert.equal(valid(receipt, expected), true)
  assert.equal(valid({ ...receipt, data: { ...receipt.data, replayed: true } }, expected), true)
  assert.equal(valid({ ...receipt, data: { ...receipt.data, value: { ...receipt.data.value, score: { value_score: null, priority_score: null, missing: ['reach'] } } } }, expected), true)
})
test('assessment receipt rejects empty success, wrong identities, revision drift and fabricated scores', () => {
  for (const bad of [{ code: 0 }, { code: 0, data: {} }]) assert.equal(valid(bad, expected), false)
  for (const patch of [{ item_biz_id: 'other' }, { cycle_biz_id: 'other' }, { workspace_revision: 10 }, { cycle_revision: 4 }, { queue_revision: 3 }, { assessment_id: 0 }, { score: { value_score: 90, priority_score: '90.00000000', missing: [] } }, { score: { value_score: null, priority_score: null, missing: [] } }, { score: { value_score: null, priority_score: '90', missing: [] } }]) assert.equal(valid({ ...receipt, data: { ...receipt.data, value: { ...receipt.data.value, ...patch } } }, expected), false)
})

test('weighted receipt requires a bounded value score for a complete recommendation', () => {
  const weighted = { ...expected, rice: false }
  assert.equal(valid(receipt, weighted), false)
  for (const value_score of [0, 100]) assert.equal(valid({ ...receipt, data: { ...receipt.data, value: { ...receipt.data.value, score: { ...receipt.data.value.score, value_score } } } }, weighted), true)
  for (const value_score of [-1, 101, 2.5]) assert.equal(valid({ ...receipt, data: { ...receipt.data, value: { ...receipt.data.value, score: { ...receipt.data.value.score, value_score } } } }, weighted), false)
})
