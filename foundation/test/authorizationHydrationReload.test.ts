import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const authorizationSource = readFileSync(
  new URL('../app/composables/useAuthorization.ts', import.meta.url),
  'utf8'
)

describe('authorization hydration reload', () => {
  test('reloads the authorization snapshot when client authentication becomes ready', () => {
    assert.match(authorizationSource, /let authWatcherInstalled = false/)
    assert.match(
      authorizationSource,
      /if \(import\.meta\.client && !authWatcherInstalled\)[\s\S]*watch\(authFingerprint[\s\S]*fingerprint\.startsWith\('1\|'\)/
    )
    assert.match(authorizationSource, /void loadAuthorization\(\{ force: true \}\)/)
    assert.match(authorizationSource, /\{ flush: 'post' \}/)
  })
})
