import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPrivateUnsharedEditorCandidate } from '../../codocs/layer/documentEditingBoundary.mjs'

const base = { hosted: true, docType: 'private', ownerUid: 'owner', actorUid: 'owner', sharesVerified: true, shareCount: 0 }

test('Host private HTTP editing requires a verified unshared owner document', () => {
  assert.equal(isPrivateUnsharedEditorCandidate(base), true)
  for (const change of [
    { sharesVerified: false },
    { shareCount: 1 },
    { actorUid: 'viewer' },
    { actorUid: '' },
    { docType: 'department' }
  ]) assert.equal(isPrivateUnsharedEditorCandidate({ ...base, ...change }), false, JSON.stringify(change))
  assert.equal(isPrivateUnsharedEditorCandidate({ ...base, hosted: false, sharesVerified: false }), true)
})
