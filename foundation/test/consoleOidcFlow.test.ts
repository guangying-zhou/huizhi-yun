import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createConsoleOidcTransientCookieNames,
  consoleOidcTransientCookiesToPrune,
  consoleOidcTransientPath,
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

test('repeated logins retain at most one prior state without touching other apps or sessions', () => {
  const states = ['A', 'B', 'C'].map(c => c.repeat(32))
  const groups = states.map(state => Object.values(createConsoleOidcTransientCookieNames('enterprise', state)))
  const others = [...Object.values(createConsoleOidcTransientCookieNames('codocs', states[0])), 'hzy_enterprise_access_token']
  const names = [...groups.flat(), ...others, ...Object.values(createConsoleOidcTransientCookieNames('enterprise'))]
  const prune = consoleOidcTransientCookiesToPrune('enterprise', names)
  assert.deepEqual(names.filter(name => !prune.includes(name)), [...groups[2], ...others])
  assert.deepEqual(consoleOidcTransientCookiesToPrune('enterprise', names, false), names.filter(name => !others.includes(name)))
})

test('transient path is exact application prefix for self-hosted, CF and hzy0 callbacks', () => {
  for (const host of ['https://aidcp.wiztek.cn', 'https://hzy0.isme.dev', 'https://tenant.huizhi.yun']) {
    assert.equal(consoleOidcTransientPath(`${host}/enterprise/api/auth/callback`), '/enterprise')
    assert.equal(consoleOidcTransientPath(`${host}/codocs/api/auth/callback`), '/codocs')
    assert.equal(consoleOidcTransientPath(`${host}/api/auth/callback`), '/')
  }
})
