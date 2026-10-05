import test from 'node:test'
import assert from 'node:assert/strict'
import { productFeedbackRuntimeError } from '../server/utils/productFeedbackRuntimeError'
import { classifyServiceOperationFailure, resolveServiceOperationConflictDisposition } from '../../foundation/server/utils/serviceOperation'

test('feedback revision conflicts are permanent and private diagnostics stay internal', () => {
  const error = productFeedbackRuntimeError({ code: 1, data: { upstreamStatus: 409, error: { code: 'feedback_progress_revision_conflict', message: 'private database diagnostic' } } })
  assert.equal(error.statusCode, 409)
  assert.equal(classifyServiceOperationFailure(error, { conflictDisposition: resolveServiceOperationConflictDisposition(error) }).retryable, false)
  assert.equal(JSON.stringify(error).includes('private database'), false)
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(productFeedbackRuntimeError({ code: 1, data: { statusCode: status } }).statusCode, status)
  assert.equal(productFeedbackRuntimeError({ code: 1, data: { statusCode: 500 } }).statusCode, 503)
})
