import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clampRefreshTokenTtlSeconds,
  MIN_REFRESH_TOKEN_TTL_SECONDS
} from '../server/utils/oidcTokenLifetime.ts'

describe('OIDC refresh token lifetime', () => {
  test('never outlives the backing Console session', () => {
    const now = Date.parse('2026-07-21T10:00:00.000Z')
    const sessionExpiresAt = '2026-07-21T18:00:00.000Z'

    assert.equal(
      clampRefreshTokenTtlSeconds(30 * 24 * 60 * 60, sessionExpiresAt, now),
      8 * 60 * 60
    )
  })

  test('keeps a shorter configured refresh token lifetime', () => {
    const now = Date.parse('2026-07-21T10:00:00.000Z')
    const sessionExpiresAt = '2026-07-21T18:00:00.000Z'

    assert.equal(clampRefreshTokenTtlSeconds(3600, sessionExpiresAt, now), 3600)
  })

  test('does not issue a refresh token when the session is nearly expired', () => {
    const now = Date.parse('2026-07-21T10:00:00.000Z')
    const sessionExpiresAt = new Date(now + (MIN_REFRESH_TOKEN_TTL_SECONDS - 1) * 1000).toISOString()

    assert.equal(clampRefreshTokenTtlSeconds(3600, sessionExpiresAt, now), 0)
  })

  test('token issuance and both OAuth grants expose the clamped refresh lifetime', () => {
    const oidcSource = readFileSync(new URL('../server/utils/oidc.ts', import.meta.url), 'utf8')
    const tokenRouteSource = readFileSync(new URL('../server/routes/oauth/token.post.ts', import.meta.url), 'utf8')

    assert.match(oidcSource, /clampRefreshTokenTtlSeconds\(/)
    assert.match(oidcSource, /ttlSeconds:\s*refreshExpiresIn/)
    assert.equal(
      tokenRouteSource.match(/refresh_expires_in:\s*tokenSet\.refreshExpiresIn/g)?.length,
      2
    )
  })
})
