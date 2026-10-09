import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Aims legacy WeCom login guard', () => {
  test('rejects the default Console OIDC mode before reading query input, resolving the integration, or redirecting', () => {
    const login = source('server/api/auth/wecom-login.get.ts')
    const guard = login.indexOf('if (!isLegacyAuthEnabled(event))')

    assert.notEqual(guard, -1)
    assert.match(login, /statusCode:\s*410/)
    assert.match(login, /Use Console OIDC login/)

    for (const legacyEffect of [
      'const query = getQuery(event)',
      'await getWecomOAuthConfig()',
      'return sendRedirect(event, authUrl)'
    ]) {
      const effect = login.indexOf(legacyEffect)
      assert.notEqual(effect, -1, `Missing ${legacyEffect}`)
      assert.ok(guard < effect, `The guard must precede ${legacyEffect}`)
    }
  })
})
