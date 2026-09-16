import assert from 'node:assert/strict'
import test from 'node:test'
import { productVersionPublishInput } from '../server/utils/productVersionPublishInput'

test('publication binds path, acceptance and revisions without actor overrides', () => {
  const draft = { acceptanceId: 9, expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 1, reason: '独立核验后发布' }
  assert.deepEqual(productVersionPublishInput(draft, 7), { version_id: 7, acceptance_id: 9, expected_revision: 3, expected_version_revision: 2, expected_scope_revision: 1, reason: draft.reason })
  for (const override of [{ execution_review_hash: 'a'.repeat(64) }, { executionReviewHash: 'a'.repeat(64) }, { versionId: 8 }, { releasedBy: 'admin' }, { evidenceLevel: 'verified' }, { acceptanceId: '9' }, { acceptanceId: 0 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { expectedScopeRevision: null }, { reason: ' ' }, { reason: '\0' }, { reason: 'x'.repeat(2001) }]) assert.equal(productVersionPublishInput({ ...draft, ...override }, 7), null)
  assert.equal(productVersionPublishInput(draft, 0), null)
  assert.equal(productVersionPublishInput(null, 7), null)
})
