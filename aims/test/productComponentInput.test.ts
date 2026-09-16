import test from 'node:test'
import assert from 'node:assert/strict'
import { productComponentPageInput, productComponentWriteInput } from '../server/utils/productComponentInput'

test('component paging distinguishes roots from explicit parent and rejects ambiguous input', () => {
  assert.deepEqual(productComponentPageInput({}), { parent_id: null, page: 1, page_size: 20 })
  assert.deepEqual(productComponentPageInput({ parentId: '7', page: '2', pageSize: '10' }), { parent_id: 7, page: 2, page_size: 10 })
  for (const raw of [{ parentId: '' }, { parentId: ['7'] }, { parentId: '0' }, { parentId: '9007199254740992' }, { page: '0' }, { pageSize: '101' }, { actor_uid: 'other' }]) assert.equal(productComponentPageInput(raw), null)
})

test('component writes require explicit parent and route-bound identity with bounded fields', () => {
  const draft = { parentId: null, expectedRevision: 1, name: '认证' }
  assert.deepEqual(productComponentWriteInput(draft), { parent_id: null, expected_revision: 1, name: '认证', description: '', sort_order: 0 })
  for (const raw of [{ ...draft, parentId: undefined }, { ...draft, parentId: '1' }, { ...draft, name: ' ' }, { ...draft, name: '字'.repeat(256) }, { ...draft, description: '\ud800' }, { ...draft, sortOrder: 2147483648 }, { ...draft, actor_uid: 'other' }]) assert.equal(productComponentWriteInput(raw), null)
  const move = { parentId: 2, expectedRevision: 3, expectedComponentRevision: 1, reason: '归类' }
  assert.equal(productComponentWriteInput(move, 7)?.component_id, 7)
  for (const raw of [{ ...move, component_id: 8 }, { ...move, reason: '' }, { ...move, reason: '字'.repeat(2001) }, { ...move, expectedComponentRevision: 0 }]) assert.equal(productComponentWriteInput(raw, 7), null)
})
