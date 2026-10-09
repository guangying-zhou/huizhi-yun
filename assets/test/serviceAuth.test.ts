import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { H3Event } from 'h3'
import { requireServiceScope } from '../server/utils/serviceAuth.ts'

const requirement = { scope: 'assets:offboarding-recovery:sync', allowedApps: ['people'] }
const validAuth = {
  authenticated: true,
  tokenUse: 'service',
  subjectType: 'service',
  appCode: 'people',
  clientCode: 'people.runtime',
  scopes: [requirement.scope]
}

function eventWith(consoleAuth: Record<string, unknown>) {
  return { context: { consoleAuth } } as unknown as H3Event
}

function assertRejectedBeforeHandler(consoleAuth: Record<string, unknown>, statusCode: number) {
  let calls = 0
  assert.throws(() => {
    requireServiceScope(eventWith(consoleAuth), requirement)
    calls += 1
  }, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    return true
  })
  assert.equal(calls, 0)
}

describe('Assets service auth failure classification', () => {
  test('catalog relies on exact Console grant without a duplicate caller allowlist', () => {
    const capability = { scope: 'assets:product:read' }
    for (const appCode of ['aims', 'registered-integration']) {
      assert.equal(requireServiceScope(eventWith({ ...validAuth, appCode, scopes: [capability.scope] }), capability).sourceApp, appCode)
    }
    for (const scopes of [[], ['assets:read'], ['assets.read'], ['assets:*']]) {
      assert.throws(() => requireServiceScope(eventWith({ ...validAuth, scopes }), capability), { statusCode: 403 })
    }
    assert.throws(() => requireServiceScope(eventWith({ ...validAuth, appCode: '', clientCode: '', scopes: [capability.scope] }), capability), { statusCode: 403 })
  })

  test('maps invalid, expired, and revoked service identity to 401 before handler', () => {
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
