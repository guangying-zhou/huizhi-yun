import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console scoped authorization runtime APIs', () => {
  test('session endpoint forwards scoped request fields to policy scoped authorization', () => {
    const content = source('server/api/auth/scoped-authorization.post.ts')

    assert.match(content, /resolveConsoleSession\(event\)/)
    assert.match(content, /const body = await readBody<Record<string, unknown>>\(event\)/)
    assert.match(content, /const targetAppCode = stringValue\(body\.appCode\) \|\| appCode/)
    assert.match(content, /loadPolicyScopedAuthorization\(session\.uid, targetAppCode, event/)
    assert.match(content, /activeRoleCode: stringValue\(body\.activeRoleCode\)/)
    assert.match(content, /authorizationMode: stringValue\(body\.authorizationMode\)/)
    assert.match(content, /resourceCode: stringValue\(body\.resourceCode\)/)
    assert.match(content, /action: stringValue\(body\.action\)/)
    assert.match(content, /body\.object && typeof body\.object === 'object'/)
  })

  test('bearer endpoint defaults appCode from token audience and forwards simulation fields', () => {
    const content = source('server/api/v1/console/user/scoped-authorization.post.ts')

    assert.match(content, /bearerToken\(getHeader\(event, 'authorization'\)\)/)
    assert.match(content, /verifyAccessToken\(event, token\)/)
    assert.match(content, /const audience = audienceFromPayload\(payload\)/)
    assert.match(content, /const targetAppCode = stringValue\(body\.appCode\) \|\| audience/)
    assert.match(content, /loadPolicyScopedAuthorization\(uid, targetAppCode, event/)
    assert.match(content, /activeRoleCode: stringValue\(body\.activeRoleCode\)/)
    assert.match(content, /authorizationMode: stringValue\(body\.authorizationMode\)/)
    assert.match(content, /resourceCode: stringValue\(body\.resourceCode\)/)
    assert.match(content, /action: stringValue\(body\.action\)/)
  })

  test('both endpoints disable caching and preserve policy authorization error reason', () => {
    for (const file of [
      'server/api/auth/scoped-authorization.post.ts',
      'server/api/v1/console/user/scoped-authorization.post.ts'
    ]) {
      const content = source(file)

      assert.match(content, /Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'/)
      assert.match(content, /isPolicyAuthorizationError\(error\)/)
      assert.match(content, /statusCode: error\.statusCode/)
      assert.match(content, /reason: error\.reason/)
      assert.match(content, /statusMessage: 'Policy Authorization Unavailable'/)
    }
  })
})
