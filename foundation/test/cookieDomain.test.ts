import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { getAuthCookieDomain } from '../server/utils/cookie-domain'

const event = {
  node: {
    req: {
      headers: {
        'x-forwarded-host': 'hzy0.isme.dev'
      }
    }
  }
} as never

describe('getAuthCookieDomain', () => {
  afterEach(() => {
    delete process.env.HZY_AUTH_COOKIE_HOST_ONLY
  })

  test('uses the existing shared domain by default', () => {
    assert.equal(getAuthCookieDomain(event), '.isme.dev')
  })

  test('keeps auth cookies host-only when explicitly requested', () => {
    process.env.HZY_AUTH_COOKIE_HOST_ONLY = 'true'
    assert.equal(getAuthCookieDomain(event), undefined)
  })
})
