import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productQueueMoveInput } from '../server/utils/productQueueInput.ts'

const cycle = '00000000-0000-4000-8000-000000000001', item = '00000000-0000-4000-8000-000000000002', anchor = '00000000-0000-4000-8000-000000000003'
const input = { itemId: item, beforeId: anchor, expectedRevision: 1, expectedCycleRevision: 2, expectedQueueRevision: 3, reason: '优先处理' }
test('queue move binds one relative anchor and three exact revisions', () => {
  assert.deepEqual(productQueueMoveInput(input, cycle)?.move, { item_id: item, before_id: anchor })
  const { beforeId: _before, ...after } = input
  assert.deepEqual(productQueueMoveInput({ ...after, afterId: anchor }, cycle)?.move, { item_id: item, after_id: anchor })
  for (const patch of [{ beforeId: item }, { beforeId: undefined }, { afterId: anchor }, { beforeId: null }, { items: [item, anchor] }, { actor: 'admin' }, { reason: '' }, { reason: '\uD800' }, { expectedQueueRevision: '3' }, { expectedRevision: 0 }, { expectedCycleRevision: 1.5 }]) assert.equal(productQueueMoveInput({ ...input, ...patch }, cycle), null)
  assert.equal(productQueueMoveInput(input, 'bad'), null)
})
