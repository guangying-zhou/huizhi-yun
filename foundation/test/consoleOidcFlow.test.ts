import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createConsoleOidcTransientCookieNames,
  isConsoleOidcReauthenticationRequired
} from '../server/utils/consoleOidcFlow'

describe('Console OIDC flow helpers', () => {
  test('isolates transient cookies for concurrent authorization states', () => {
    const first = createConsoleOidcTransientCookieNames('people', 'state_A234567890123456789012345678901')
    const second = createConsoleOidcTransientCookieNames('people', 'state_B234567890123456789012345678901')

    assert.notDeepEqual(first, second)
    assert.match(first.codeVerifier, /^hzy_people_oidc_code_verifier_state_A/)
    assert.match(second.codeVerifier, /^hzy_people_oidc_code_verifier_state_B/)
  })

  test('retains legacy fixed names when no valid state is supplied', () => {
    assert.deepEqual(createConsoleOidcTransientCookieNames('finance'), {
      state: 'hzy_finance_oidc_state',
      nonce: 'hzy_finance_oidc_nonce',
      codeVerifier: 'hzy_finance_oidc_code_verifier',
      redirect: 'hzy_finance_oidc_redirect'
    })
    assert.deepEqual(
      createConsoleOidcTransientCookieNames('finance', 'invalid state'),
      createConsoleOidcTransientCookieNames('finance')
    )
  })

  test('classifies only invalid refresh grants as expected reauthentication', () => {
    assert.equal(isConsoleOidcReauthenticationRequired({
      statusCode: 400,
      data: { message: 'invalid_grant: session revoked or expired' }
    }), true)
    assert.equal(isConsoleOidcReauthenticationRequired({
      statusCode: 400,
      data: {
        error: {
          code: 'invalid_grant',
          message: 'invalid_grant: refresh token expired'
        }
      }
    }), true)
    assert.equal(isConsoleOidcReauthenticationRequired({
      response: {
        status: 400,
        _data: {
          data: {
            code: 'invalid_grant',
            message: 'invalid_grant: session revoked or expired'
          }
        }
      }
    }), true)
    assert.equal(isConsoleOidcReauthenticationRequired({
      statusCode: 401,
      message: 'Missing refresh token'
    }), true)
    assert.equal(isConsoleOidcReauthenticationRequired({
      statusCode: 503,
      data: { message: 'data runtime unavailable' }
    }), false)
    assert.equal(isConsoleOidcReauthenticationRequired({
      statusCode: 400,
      data: { message: 'invalid_client' }
    }), false)
  })
})
