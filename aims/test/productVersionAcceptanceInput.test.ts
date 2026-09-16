import assert from 'node:assert/strict'
import test from 'node:test'
import { productVersionAcceptanceInput } from '../server/utils/productVersionAcceptanceInput'

test('version acceptance binds review hash, path identity and complete evidence', () => {
  const draft = { expectedRevision: 1, expectedVersionRevision: 1, expectedScopeRevision: 1, expectedReviewHash: 'a'.repeat(64), checks: ['execution-review', 'blocking-defects-review', 'release-readiness'].map(code => ({ code, evidence: '核验记录' })), exceptions: [] }
  assert.equal(productVersionAcceptanceInput(draft, 3)?.version_id, 3)
  for (const extra of [{ execution_review_hash: 'a'.repeat(64) }, { executionReviewHash: 'a'.repeat(64) }, { versionId: 4 }, { acceptedBy: 'other' }, { expectedReviewHash: 'A'.repeat(64) }, { expectedReviewHash: '' }, { expectedRevision: '1' }, { checks: [] }, { checks: [draft.checks[0], draft.checks[0], draft.checks[2]] }, { checks: draft.checks.map(check => ({ ...check, passed: true })) }, { exceptions: null }, { exceptions: [{ code: 'risk', reason: '原因' }] }]) assert.equal(productVersionAcceptanceInput({ ...draft, ...extra }, 3), null)
  const exception = { code: 'open-defect:7', reason: '风险已核验', responsibleUid: 'pm', impact: '跟踪后续修复' }
  assert.equal(productVersionAcceptanceInput({ ...draft, exceptions: [exception] }, 3)?.exceptions[0]?.responsible_uid, 'pm')
  assert.equal(productVersionAcceptanceInput({ ...draft, exceptions: [exception, exception] }, 3), null)
})
