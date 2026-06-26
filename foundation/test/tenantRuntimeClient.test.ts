import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { tenantRuntimeErrorData } from '../server/utils/tenantRuntimeErrors.ts'

describe('tenantRuntimeErrorData', () => {
  test('preserves business error code and 4xx status from tenant runtime', () => {
    assert.deepEqual(
      tenantRuntimeErrorData({
        statusCode: 409,
        data: { error: { code: 'coverage_target_conflict', message: 'target already exists' } }
      }),
      {
        statusCode: 409,
        code: 'coverage_target_conflict',
        message: 'target already exists',
        upstreamStatus: 409
      }
    )
  })

  test('maps upstream 5xx to caller 502 while preserving upstream status', () => {
    assert.deepEqual(
      tenantRuntimeErrorData({
        status: 503,
        data: { error: { code: 'runtime_unavailable', message: 'runtime down' } }
      }),
      {
        statusCode: 502,
        code: 'runtime_unavailable',
        message: 'runtime down',
        upstreamStatus: 503
      }
    )
  })
})
