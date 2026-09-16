import assert from 'node:assert/strict'
import test from 'node:test'
import { productHandoffProjectObject } from '../server/utils/productHandoffProjectAuthorizationCore'

test('handoff project context binds the exact actor and project facts', () => {
  const facts = { project_id: 42, project_code: 'PRJ', actor_uid: 'pm', department_code: 'DEV', leader_uid: 'leader', created_by: 'creator', is_member: true }
  const object = productHandoffProjectObject(facts, 'PRJ', 'pm')!
  assert.equal(object.projectId, 42)
  assert.equal(object.ownerUid, 'creator')
  assert.equal(object.projectOwnerUid, 'leader')
  assert.deepEqual(object.projectMemberUids, ['pm'])
  assert.equal(object.matchedRelations?.includes('project:manager'), false)
  assert.equal(productHandoffProjectObject(facts, 'OTHER', 'pm'), null)
  assert.equal(productHandoffProjectObject(facts, 'PRJ', 'other'), null)
  assert.equal(productHandoffProjectObject({ ...facts, project_id: 0 }, 'PRJ', 'pm'), null)
  const revoked = productHandoffProjectObject({ ...facts, is_member: false }, 'PRJ', 'pm')!
  assert.deepEqual(revoked.projectMemberUids, [])
  assert.deepEqual(revoked.matchedRelations, [])
  const leader = productHandoffProjectObject({ ...facts, leader_uid: 'pm' }, 'PRJ', 'pm')!
  assert.ok(leader.matchedRelations?.includes('project:manager'))
})
