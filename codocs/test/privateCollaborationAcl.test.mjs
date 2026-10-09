import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canStartPrivateCollaboration } from '../layer/documentEditingBoundary.mjs'

const acl = { docType: 'private', ownerUid: 'owner', actorUid: 'sharee', aclVerified: true, readonlyFlag: 0, sharesVerified: false, shareCount: 0, accessWithdrawn: false }
test('write sharee starts without owner-only list; read-only, revoked and unknown ACL never start', () => {
  assert.equal(canStartPrivateCollaboration(acl), true)
  for (const change of [{ readonlyFlag: 1 }, { readonlyFlag: undefined }, { aclVerified: false }, { accessWithdrawn: true }, { actorUid: '' }, { ownerUid: '' }, { docType: 'company' }]) {
    assert.equal(canStartPrivateCollaboration({ ...acl, ...change }), false)
  }
})
test('owner waits for verified nonempty shares; private unshared documents never start', () => {
  const owner = { ...acl, actorUid: 'owner' }
  assert.equal(canStartPrivateCollaboration(owner), false)
  assert.equal(canStartPrivateCollaboration({ ...owner, sharesVerified: true }), false)
  assert.equal(canStartPrivateCollaboration({ ...owner, sharesVerified: true, shareCount: 1 }), true)
  assert.equal(canStartPrivateCollaboration({ ...owner, sharesVerified: true, shareCount: 1, readonlyFlag: 1 }), false)
})
test('editor uses successful server read ACL, clears on re-read and stops after access withdrawal', () => {
  const source = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
  assert.match(source, /privateDocumentAclVerified\.value = response\.data\.doc_type === 'private' && response\.data\.readonly_flag === 0/)
  assert.match(source, /privateDocumentAclVerified\.value = null/)
  assert.match(source, /aclDocumentId === documentId\.value && aclActorUid === authUserId\.value/)
  assert.match(source, /privateDocumentAclVerified\.value\?\.actorUid === authUserId\.value/)
  assert.match(source, /accessWithdrawn: Boolean\(collaboration\.closeKind\.value\)/)
  assert.match(source, /\|\| privateCollaborationWanted\.value \|\| departmentSessionWanted\.value/)
  assert.match(source, /!isDocumentOwner\.value \|\| isDepartmentScene\.value/)
})

test('detail adapters preserve actor-specific readonly ACL rather than raw document writability', () => {
  const host = readFileSync(new URL('../../enterprise/server/utils/enterpriseCodocsDocumentContent.ts', import.meta.url), 'utf8')
  const standalone = readFileSync(new URL('../server/api/documents/[uuid]/index.get.ts', import.meta.url), 'utf8')
  assert.match(host, /readonly_flag: doc\.readonly \? 1 : doc\.readonly_flag/)
  assert.match(standalone, /readonly_flag: metadata\.readonly \? 1 : metadata\.readonly_flag/)
})
