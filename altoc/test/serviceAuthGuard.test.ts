import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AIMS_DELIVERY_RESULT_SERVICE_AUTH,
  runWithAltocServiceAuth
} from '../server/utils/serviceAuthGuard.ts'

function assertHTTPError(statusCode: number, message: RegExp) {
  return (error: unknown) => {
    const value = error as { statusCode?: number, message?: string }
    assert.equal(value.statusCode, statusCode)
    assert.match(String(value.message || ''), message)
    return true
  }
}

describe('Aims to Altoc delivery-result service auth', () => {
  const validAuth = {
    authenticated: true,
    tokenUse: 'service',
    subjectType: 'service',
    appCode: 'aims',
    clientCode: 'aims.runtime',
    scopes: ['altoc:service-ticket:delivery-result:sync']
  }

  test('rejects unauthenticated callers before invoking the delivery handler', async () => {
    let calls = 0
    await assert.rejects(
      () => runWithAltocServiceAuth({ ...validAuth, authenticated: false }, AIMS_DELIVERY_RESULT_SERVICE_AUTH, () => {
        calls += 1
      }),
      assertHTTPError(401, /service token is required/i)
    )
    assert.equal(calls, 0)
  })

  test('preserves Console introspection outages as retryable 503 before invoking the delivery handler', async () => {
    let calls = 0
    await assert.rejects(
      () => runWithAltocServiceAuth({
        ...validAuth,
        authenticated: false,
        reason: 'service_token_introspection_unavailable'
      }, AIMS_DELIVERY_RESULT_SERVICE_AUTH, () => {
        calls += 1
      }),
      assertHTTPError(503, /introspection is unavailable/i)
    )
    assert.equal(calls, 0)
  })

  test('rejects missing capability before invoking the delivery handler', async () => {
    let calls = 0
    await assert.rejects(
      () => runWithAltocServiceAuth({ ...validAuth, scopes: ['altoc:read'] }, AIMS_DELIVERY_RESULT_SERVICE_AUTH, () => {
        calls += 1
      }),
      assertHTTPError(403, /missing required service scope/i)
    )
    assert.equal(calls, 0)
  })

  test('rejects the wrong source application before invoking the delivery handler', async () => {
    let calls = 0
    await assert.rejects(
      () => runWithAltocServiceAuth({ ...validAuth, appCode: 'finance' }, AIMS_DELIVERY_RESULT_SERVICE_AUTH, () => {
        calls += 1
      }),
      assertHTTPError(403, /caller is not allowed/i)
    )
    assert.equal(calls, 0)
  })

  test('allows the verified Aims service caller and invokes the delivery handler once', async () => {
    let calls = 0
    const result = await runWithAltocServiceAuth(validAuth, AIMS_DELIVERY_RESULT_SERVICE_AUTH, () => {
      calls += 1
      return { delivered: true }
    })
    assert.deepEqual(result, { delivered: true })
    assert.equal(calls, 1)
  })
})
