import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productDependencyEditInput, productDependencyReadInput } from '../server/utils/productDependencyInput.ts'

const item = '00000000-0000-4000-8000-000000000001'
const predecessor = '00000000-0000-4000-8000-000000000002'
const input = { expectedRevision: 1, expectedItemRevision: 2, predecessorIds: [predecessor], reason: '共用基础能力' }
test('dependency read binds the item and never accepts a subset', () => {
  assert.deepEqual(productDependencyReadInput({}, item), { item_biz_id: item })
  for (const query of [{ page: '1' }, { keyword: 'one' }, { actor: 'admin' }, { itemId: predecessor }]) assert.equal(productDependencyReadInput(query, item), null)
  assert.equal(productDependencyReadInput({}, 'bad'), null)
})
test('dependency replacement requires a complete unique set and exact revisions', () => {
  assert.deepEqual(productDependencyEditInput(input, item), { item_biz_id: item, expected_revision: 1, expected_item_revision: 2, predecessor_biz_ids: [predecessor], reason: input.reason, impact_note: '' })
  assert.deepEqual(productDependencyEditInput({ ...input, predecessorIds: [] }, item)?.predecessor_biz_ids, [])
  for (const predecessorIds of [undefined, null, {}, [item], ['invalid'], [predecessor, predecessor], Array(101).fill(predecessor)]) assert.equal(productDependencyEditInput({ ...input, predecessorIds }, item), null)
  for (const key of ['expectedRevision', 'expectedItemRevision']) for (const value of [0, -1, '1', null, Number.MAX_SAFE_INTEGER + 1]) assert.equal(productDependencyEditInput({ ...input, [key]: value }, item), null)
  for (const patch of [{ actor: 'admin' }, { itemId: predecessor }, { scopeRevision: 3 }, { reason: '' }, { impactNote: '\uD800' }, { impactNote: null }]) assert.equal(productDependencyEditInput({ ...input, ...patch }, item), null)
})
