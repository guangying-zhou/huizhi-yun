import test from 'node:test'
import assert from 'node:assert/strict'
import { productCostRuntimeError } from '../server/utils/productCostRuntimeError.ts'
import { classifyServiceOperationFailure, resolveServiceOperationConflictDisposition } from '../../foundation/server/utils/serviceOperation.ts'

test('cost revision conflicts remain permanent and do not leak raw runtime diagnostics', () => {
  const error = productCostRuntimeError({ code: 1, data: { upstreamStatus: 409, error: { code: 'product_cost_revision_conflict', message: 'private database diagnostic' } } })
  assert.equal(error.statusCode, 409)
  const result = classifyServiceOperationFailure(error, { conflictDisposition: resolveServiceOperationConflictDisposition(error) })
  assert.equal(result.retryable, false)
  assert.equal(JSON.stringify(error).includes('private database'), false)
  assert.equal(productCostRuntimeError({ code: 1, data: { statusCode: 403 } }).statusCode, 403)
  assert.equal(productCostRuntimeError({ code: 1, data: { statusCode: 500 } }).statusCode, 503)
})
