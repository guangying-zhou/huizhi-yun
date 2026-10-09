import test from 'node:test'
import assert from 'node:assert/strict'
import { productVersionReopenInput } from '../server/utils/productVersionReopenInput'

test('reopen requires immutable source reference and trusted path', () => {
  const body = { releaseRecordId: 3, expectedRevision: 8, expectedVersionRevision: 4, reason: '修正范围' }
  assert.equal(productVersionReopenInput(body, 2)?.release_record_id, 3)
  for (const extra of [{ releaseRecordId: 0 }, { releaseRecordId: '3' }, { expectedRevision: 0 }, { actorUid: 'admin' }, { status: 'developing' }, { versionId: 9 }, { reason: '' }, { reason: '\0' }, { reason: 'x'.repeat(2001) }]) assert.equal(productVersionReopenInput({ ...body, ...extra }, 2), null)
  assert.equal(productVersionReopenInput(body, 0), null)
})
