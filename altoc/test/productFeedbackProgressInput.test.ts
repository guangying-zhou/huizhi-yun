import test from 'node:test'
import assert from 'node:assert/strict'
import { validProductFeedbackProgress } from '../server/utils/productFeedbackProgressInput'

test('progress snapshot rejects invalid dates, counts and private fields', () => {
  const version = { versionCode: 'v1', status: 'planning', plannedReleaseDate: '2026-09-01', releasedAt: null, publicFeatureCount: 2, deliveredFeatureCount: 0 }
  const command = { ticketCode: 'ST1', productCode: 'P1', requestBizId: 'same', canonicalRequestBizId: 'same', decisionStatus: 'accepted', canonicalDecisionStatus: 'accepted', sourceRevision: 1, versions: [version] }
  assert.equal(validProductFeedbackProgress(command), true)
  assert.equal(validProductFeedbackProgress({ ...command, versions: [] }), true)
  for (const change of [{ plannedReleaseDate: '2026-02-30' }, { releasedAt: '2026-09-01' }, { publicFeatureCount: null }, { deliveredFeatureCount: 3 }, { versionCode: 'x\n' }, { description: 'PRIVATE' }]) {
    assert.equal(validProductFeedbackProgress({ ...command, versions: [{ ...version, ...change }] }), false)
  }
  assert.equal(validProductFeedbackProgress({ ...command, versions: [version, version] }), false)
  assert.equal(validProductFeedbackProgress({ ...command, canonicalDecisionStatus: 'merged' }), false)
  assert.equal(validProductFeedbackProgress({ ...command, canonicalDecisionStatus: 'evaluating' }), false)
})
