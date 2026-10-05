import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const authorizationSource = readFileSync(
  new URL('../app/composables/useAuthorization.ts', import.meta.url),
  'utf8'
)

describe('authorization SSR request context', () => {
  test('forwards the incoming request context and validates the snapshot envelope', () => {
    assert.match(
      authorizationSource,
      /if \(import\.meta\.server\) \{[\s\S]*useRequestFetch\(\)[\s\S]*\} else \{[\s\S]*\$fetch/
    )
    // The endpoint comes from the shared resolver (standalone root or Host per-module path).
    assert.match(authorizationSource, /const response = await requestFetch\(source\.url\)/)
    assert.match(authorizationSource, /return parseAuthorizationSnapshotResponse\(response, source\.expectedApp\)/)
    assert.match(authorizationSource, /resolveAuthorizationSnapshotSource\(publicConfig, routeMeta\(\)\)/)
    // No silent empty snapshot for an unexpected response.
    assert.doesNotMatch(authorizationSource, /response\.code === 0 && response\.data/)
  })
})
