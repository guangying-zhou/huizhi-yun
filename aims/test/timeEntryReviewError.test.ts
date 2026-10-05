import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTimeEntryReviewVersionConflict, timeEntryReviewErrorMessage } from '../app/utils/timeEntryReviewError'

const hostError = (statusCode: number, code: string) => ({
  statusCode,
  data: { statusCode, message: 'Internal English diagnostic', data: { code } }
})
const gatewayError = (statusCode: number, code: string) => ({
  statusCode,
  data: { statusCode, code, message: 'Gateway diagnostic' }
})

test('review errors have Chinese business messages for Host and Gateway envelopes', () => {
  for (const makeError of [hostError, gatewayError]) {
    assert.equal(timeEntryReviewErrorMessage(makeError(409, 'time_entry_review_version_conflict')), '所选工时已被他人处理或已变更，列表已刷新，请重新确认')
    assert.equal(timeEntryReviewErrorMessage(makeError(403, 'time_entry_reviewer_changed')), '审核人已变更，您不再是这些工时的审核人')
    assert.equal(timeEntryReviewErrorMessage(makeError(403, 'time_entry_self_review_denied')), '不能审核自己的工时')
    assert.equal(isTimeEntryReviewVersionConflict(makeError(409, 'time_entry_review_version_conflict')), true)
    assert.equal(isTimeEntryReviewVersionConflict(makeError(403, 'time_entry_reviewer_changed')), false)
  }
})

test('only the exact 409 version conflict triggers a refresh; other errors retain the page fallback', () => {
  assert.equal(isTimeEntryReviewVersionConflict(hostError(403, 'time_entry_review_version_conflict')), false)
  assert.equal(isTimeEntryReviewVersionConflict(hostError(409, 'another_conflict')), false)
  assert.equal(timeEntryReviewErrorMessage(hostError(409, 'another_conflict')), null)
  assert.equal(timeEntryReviewErrorMessage(new Error('network')), null)
})
