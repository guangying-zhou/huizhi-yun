import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { tsImport } from 'tsx/esm/api'

const { requireFinanceServiceAuth, requireFinanceServiceCapability } = await tsImport('../server/utils/serviceAuth.ts', import.meta.url) as typeof import('../server/utils/serviceAuth.ts')

const scope = 'finance:notification-details:authorize'
const validAuth = {
  authenticated: true,
  tokenUse: 'service',
  subjectType: 'service',
  appCode: 'console',
  clientCode: 'console.runtime',
  scopes: [scope]
}

function assertRejectedBeforeHandler(consoleAuth: Parameters<typeof requireFinanceServiceAuth>[0], statusCode: number) {
  let calls = 0
  assert.throws(() => {
    requireFinanceServiceAuth(consoleAuth, scope)
    calls += 1
  }, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    return true
  })
  assert.equal(calls, 0)
}

describe('Finance service auth failure classification', () => {
  test('maps invalid, expired, and revoked service identity to 401 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, tokenUse: 'access' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'invalid_token' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'revoked_service_token' }, 401)
  })

  test('maps missing capability and wrong source to 403 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, scopes: [] }, 403)
    assertRejectedBeforeHandler({ ...validAuth, appCode: 'altoc' }, 403)
  })

  test('preserves Console introspection outages as 503 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'service_token_introspection_unavailable' }, 503)
  })

  test('uses the same classification before forwarded Finance service handlers', () => {
    const forwardedRequirement = { scope: 'finance:invoice-request:create', allowedApps: ['altoc'] }
    const forwardedAuth = { ...validAuth, appCode: 'altoc', clientCode: 'altoc.runtime', scopes: [forwardedRequirement.scope] }

    let handlerCalls = 0
    requireFinanceServiceCapability(forwardedAuth, forwardedRequirement)
    handlerCalls += 1
    assert.equal(handlerCalls, 1)

    for (const [auth, statusCode] of [
      [{ ...forwardedAuth, authenticated: false, reason: 'invalid_token' }, 401],
      [{ ...forwardedAuth, authenticated: false, reason: 'revoked_service_token' }, 401],
      [{ ...forwardedAuth, scopes: [] }, 403],
      [{ ...forwardedAuth, appCode: 'people', clientCode: 'people.runtime' }, 403],
      [{ ...forwardedAuth, authenticated: false, reason: 'service_token_introspection_unavailable' }, 503]
    ] as const) {
      handlerCalls = 0
      assert.throws(() => {
        requireFinanceServiceCapability(auth, forwardedRequirement)
        handlerCalls += 1
      }, (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, statusCode)
        return true
      })
      assert.equal(handlerCalls, 0)
    }

    for (const broadScope of ['finance:*', 'finance:admin', 'finance:write', 'finance.write']) {
      assert.throws(() => requireFinanceServiceCapability(
        { ...forwardedAuth, scopes: [broadScope] },
        forwardedRequirement
      ), (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 403)
        return true
      })
      assert.doesNotThrow(() => requireFinanceServiceCapability(
        { ...forwardedAuth, scopes: [broadScope, forwardedRequirement.scope] },
        forwardedRequirement
      ))
    }
    assert.throws(() => requireFinanceServiceCapability(
      { ...validAuth, scopes: ['finance:*'] },
      { scope, allowedApps: ['console'] }
    ), (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 403)
      return true
    })
  })
})
