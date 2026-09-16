import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { tsImport } from 'tsx/esm/api'

const { requirePeopleServiceAuth } = await tsImport('../server/utils/serviceAuth.ts', import.meta.url) as typeof import('../server/utils/serviceAuth.ts')

const requirement = { scope: 'people:notification-details:authorize', allowedApps: ['console'] }
const validAuth = {
  authenticated: true,
  tokenUse: 'service',
  subjectType: 'service',
  appCode: 'console',
  clientCode: 'console.runtime',
  scopes: [requirement.scope]
}

function assertRejectedBeforeHandler(consoleAuth: Parameters<typeof requirePeopleServiceAuth>[0], statusCode: number) {
  let calls = 0
  assert.throws(() => {
    requirePeopleServiceAuth(consoleAuth, requirement)
    calls += 1
  }, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    return true
  })
  assert.equal(calls, 0)
}

describe('People service auth failure classification', () => {
  test('maps invalid, expired, and revoked service identity to 401 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, tokenUse: 'access' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'invalid_token' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'revoked_service_token' }, 401)
  })

  test('maps missing capability and wrong source to 403 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, scopes: [] }, 403)
    assertRejectedBeforeHandler({ ...validAuth, appCode: 'finance' }, 403)
  })

  test('preserves Console introspection outages as 503 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'service_token_introspection_unavailable' }, 503)
  })
})
