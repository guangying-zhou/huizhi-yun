import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isAssetsLocalDevAuthorizationBypassEnabled } from '../server/utils/assetsLocalDevAuthorization.ts'

describe('Assets local dev authorization bypass', () => {
  test('defaults to disabled so default users do not receive app permissions', () => {
    assert.equal(isAssetsLocalDevAuthorizationBypassEnabled({}), false)
  })

  test('can be explicitly enabled for local troubleshooting', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      assert.equal(isAssetsLocalDevAuthorizationBypassEnabled({ HZY_ASSETS_LOCAL_DEV_AUTH_BYPASS: value }), true)
    }
  })
})
