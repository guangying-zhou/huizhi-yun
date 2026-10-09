import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const authorizationSource = readFileSync(
  new URL('../app/composables/useAuthorization.ts', import.meta.url),
  'utf8'
)
const noAccessSource = readFileSync(
  new URL('../app/pages/no-access.vue', import.meta.url),
  'utf8'
)

describe('Finance authorization hydration reload', () => {
  test('reloads the authorization snapshot when client authentication becomes ready', () => {
    assert.match(authorizationSource, /authWatcherInstalled: false/)
    assert.match(
      authorizationSource,
      /if \(import\.meta\.client && !runtime\.authWatcherInstalled\)[\s\S]*watch\(authFingerprint[\s\S]*fingerprint\.startsWith\('1\|'\)/
    )
    assert.match(authorizationSource, /void loadAuthorization\(\{ force: true \}\)/)
    assert.match(authorizationSource, /\{ flush: 'post', immediate: true \}/)
  })

  test('isolates authorization state by Nuxt app instead of sharing one SSR module ref', () => {
    assert.match(authorizationSource, /createScopedRuntimeRegistry/)
    assert.match(authorizationSource, /authorizationRuntimeFor\(useNuxtApp\(\)\)/)
    assert.doesNotMatch(authorizationSource, /^const authorizationState =/m)
  })

  test('leaves no-access automatically after a refreshed snapshot restores dashboard access', () => {
    assert.match(noAccessSource, /watch\([\s\S]*hasPermission\('dashboard', 'view'\)[\s\S]*navigateTo\('\/'\)/)
  })
})
