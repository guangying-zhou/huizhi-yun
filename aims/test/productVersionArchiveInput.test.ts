import test from 'node:test'
import assert from 'node:assert/strict'
import { productVersionArchiveInput } from '../server/utils/productVersionArchiveInput'

test('archive binds the version path and requires all revisions and a reason', () => {
  const body = { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 1, reason: '停止维护，保留历史' }
  assert.equal(productVersionArchiveInput(body, 7)?.version_id, 7)
  for (const extra of [{ actorUid: 'admin' }, { status: 'archived' }, { versionId: 8 }, { expectedScopeRevision: 0 }, { expectedVersionRevision: '2' }, { reason: '' }, { reason: '\0' }]) assert.equal(productVersionArchiveInput({ ...body, ...extra }, 7), null)
  assert.equal(productVersionArchiveInput(body, 0), null)
})
