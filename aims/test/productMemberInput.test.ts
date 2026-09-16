import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memberChangeInput, memberPageInput } from '../server/utils/productMemberInput.ts'

const input = { uid: 'dev', expectedRevision: 1, relationType: 'contributor', status: 'active', validFrom: '2026-09-01T00:00:00.000Z', validUntil: null, reason: '加入团队' }

test('member input binds server member ID and only allows relationship fields', () => {
  assert.equal(memberChangeInput('create', input, 0, 'pm')?.continuing_manager_uid, 'pm')
  assert.equal(memberChangeInput('create', { ...input, relationType: 'manager' }, 0, 'pm')?.continuing_manager_uid, 'dev')
  for (const extra of [{ member_id: 2 }, { authorization: {} }, { directory: { active_uids: ['dev'] } }, { actorUid: 'admin' }, { productCode: 'other' }]) {
    assert.equal(memberChangeInput('create', { ...input, ...extra }, 0, 'pm'), null)
  }
  assert.equal(memberChangeInput('update', input, 3, 'pm'), null)
  assert.equal(memberChangeInput('update', { ...input, expectedMemberRevision: 2 }, 3, 'pm')?.member_id, 3)
  assert.equal(memberChangeInput('create', { ...input, expectedMemberRevision: 2 }, 0, 'pm'), null)
  assert.equal(memberChangeInput('create', { ...input, relationType: ['manager'] }, 0, 'pm'), null)
  assert.equal(memberChangeInput('create', { ...input, status: ['active'] }, 0, 'pm'), null)
})

test('member validity requires real UTC millisecond dates and a later explicit expiry', () => {
  for (const validFrom of ['2026-02-30T00:00:00.000Z', '2026-09-01', '2026-09-01T00:00:00Z', '2026-09-01T08:00:00.000+08:00']) {
    assert.equal(memberChangeInput('create', { ...input, validFrom }, 0, 'pm'), null)
  }
  assert.equal(memberChangeInput('create', { ...input, validUntil: input.validFrom }, 0, 'pm'), null)
  assert.equal(memberChangeInput('create', { ...input, validUntil: undefined }, 0, 'pm'), null)
  assert.ok(memberChangeInput('create', { ...input, validUntil: '2026-10-01T00:00:00.000Z' }, 0, 'pm'))
})

test('revocation requires reason and a current manager candidate, preserving immutable user identity', () => {
  const revoke = { uid: 'pm', expectedRevision: 2, expectedMemberRevision: 1, continuingManagerUid: 'successor', reason: '交接' }
  assert.equal(memberChangeInput('revoke', revoke, 1, 'pm')?.continuing_manager_uid, 'successor')
  assert.equal(memberChangeInput('revoke', { ...revoke, reason: '' }, 1, 'pm'), null)
  assert.equal(memberChangeInput('revoke', { ...revoke, status: 'active' }, 1, 'pm'), null)
  assert.equal(memberChangeInput('revoke', { ...revoke, uid: 'pm,other' }, 1, 'pm'), null)
})

test('member pagination is bounded and rejects extra authorization filters', () => {
  assert.deepEqual(memberPageInput({ page: '2', pageSize: '100', relationType: 'manager' }), { page: 2, page_size: 100, relation_type: 'manager', status: '' })
  for (const bad of [{ page: '0' }, { pageSize: '101' }, { page: ['1', '2'] }, { current_user: 'other' }, { relationType: 'owner' }]) {
    assert.equal(memberPageInput(bad), null)
  }
})
