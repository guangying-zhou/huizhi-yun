import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Workflow legacy WeCom route guard', () => {
  test('legacy selection has no missing-Console-issuer fallback', () => {
    const authIdentity = source('server/utils/authIdentity.ts')

    assert.match(authIdentity, /export function legacyAuthModeIsEnabled\(authMode: unknown, legacyAuthBridge: unknown\)/)
    assert.match(authIdentity, /return legacyAuthModeIsEnabled\(authMode, legacyAuthBridge\)/)
    assert.doesNotMatch(authIdentity, /\|\| !consoleOidcIssuer/)
  })

  test('callback rejects before reading its code, calling WeCom, or writing legacy cookies', () => {
    const callback = source('server/api/auth/wecom-callback.get.ts')
    const guard = callback.indexOf('if (!isLegacyAuthEnabled(event))')

    assert.notEqual(guard, -1)
    assert.match(callback, /statusCode:\s*410/)
    assert.match(callback, /Use Console OIDC login/)

    for (const legacyEffect of [
      'const q = getQuery(event)',
      'getWecomUserByCode(code)',
      'setCookie(event, \'token\''
    ]) {
      const effect = callback.indexOf(legacyEffect)
      assert.notEqual(effect, -1, `Missing ${legacyEffect}`)
      assert.ok(guard < effect, `The guard must precede ${legacyEffect}`)
    }
  })

  test('legacy login start rejects before reading input or resolving the WeCom integration', () => {
    const login = source('server/api/auth/wecom-login.get.ts')
    const guard = login.indexOf('if (!isLegacyAuthEnabled(event))')

    assert.notEqual(guard, -1)
    assert.match(login, /statusCode:\s*410/)
    assert.match(login, /Use Console OIDC login/)

    for (const legacyEffect of [
      'const query = getQuery(event)',
      'getWecomOAuthIntegrationConfig()'
    ]) {
      const effect = login.indexOf(legacyEffect)
      assert.notEqual(effect, -1, `Missing ${legacyEffect}`)
      assert.ok(guard < effect, `The guard must precede ${legacyEffect}`)
    }
  })
})
