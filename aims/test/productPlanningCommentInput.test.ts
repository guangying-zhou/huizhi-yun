import test from 'node:test'
import assert from 'node:assert/strict'
import { productPlanningCommentHistoryInput, productPlanningCommentListInput, productPlanningCommentWriteInput } from '../server/utils/productPlanningCommentInput'

const item = '11111111-1111-4111-8111-111111111111'
test('comment pagination and writes bind route identifiers and reject authority injection', () => {
  assert.deepEqual(productPlanningCommentListInput({}, item), { item_biz_id: item, page: 1, page_size: 20 })
  for (const query of [{ page: '0' }, { pageSize: '101' }, { page: ['1', '2'] }, { keyword: 'private' }]) assert.equal(productPlanningCommentListInput(query, item), null)
  const base = { expectedRevision: 2, body: '估算依据' }
  assert.deepEqual(productPlanningCommentWriteInput(base, item, 'create'), { item_biz_id: item, expected_revision: 2, body: '估算依据' })
  for (const key of ['author_uid', 'actorUid', 'authorization', 'item_biz_id', 'comment_id', 'expectedCommentRevision']) assert.equal(productPlanningCommentWriteInput({ ...base, [key]: 1 }, item, 'create'), null)
  for (const body of ['', ' ', '\0', '\ud800', 'a'.repeat(10001)]) assert.equal(productPlanningCommentWriteInput({ ...base, body }, item, 'create'), null)
  assert.equal(productPlanningCommentWriteInput(base, item, 'edit', '3'), null)
  const edit = { ...base, expectedCommentRevision: 1 }
  assert.equal(productPlanningCommentWriteInput(edit, item, 'edit', '3')?.comment_id, 3)
  for (const id of ['0', '-1', '1e2', '03', '9007199254740992']) assert.equal(productPlanningCommentWriteInput(edit, item, 'edit', id), null)
  assert.equal(productPlanningCommentWriteInput(edit, item, 'delete', '3'), null)
  assert.equal(productPlanningCommentWriteInput({ expectedRevision: 2, expectedCommentRevision: 1 }, item, 'delete', '3')?.body, '')
})

test('comment history binds route ID and allows only bounded pagination', () => {
  assert.equal(productPlanningCommentHistoryInput({}, item, '3')?.comment_id, 3)
  for (const id of ['', '0', '03', '1e2', '9007199254740992']) assert.equal(productPlanningCommentHistoryInput({}, item, id), null)
  assert.equal(productPlanningCommentHistoryInput({ comment_id: '9' }, item, '3'), null)
  assert.equal(productPlanningCommentHistoryInput({ pageSize: '101' }, item, '3'), null)
})
