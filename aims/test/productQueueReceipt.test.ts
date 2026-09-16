import test from 'node:test'
import assert from 'node:assert/strict'
import { validProductQueueReceipt as valid } from '../app/utils/productQueueReceipt.ts'

const expected = { cycleId: 'cycle-1', workspaceRevision: 8, cycleRevision: 4, queueRevision: 2 }
const value = { cycle_biz_id: 'cycle-1', changed: true, workspace_revision: 9, cycle_revision: 5, queue_revision: 3 }
const response = { code: 0, data: { receipt_id: 1, replayed: false, value } }
test('queue receipt verifies changed, unchanged and replayed results', () => {
  assert.equal(valid(response, expected), true)
  assert.equal(valid({ ...response, data: { ...response.data, replayed: true } }, expected), true)
  assert.equal(valid({ ...response, data: { ...response.data, value: { ...value, changed: false, workspace_revision: 8, cycle_revision: 4, queue_revision: 2 } } }, expected), true)
})
test('queue receipt rejects false success and inconsistent revisions', () => {
  for (const bad of [null, { code: 0 }, { code: 0, data: {} }]) assert.equal(valid(bad, expected), false)
  for (const patch of [{ cycle_biz_id: 'other' }, { changed: false }, { changed: 1 }, { workspace_revision: 8 }, { cycle_revision: 6 }, { queue_revision: 2 }]) {
    assert.equal(valid({ ...response, data: { ...response.data, value: { ...value, ...patch } } }, expected), false)
  }
  assert.equal(valid({ ...response, data: { ...response.data, receipt_id: 0 } }, expected), false)
})
