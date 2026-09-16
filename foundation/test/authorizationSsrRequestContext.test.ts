import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const authorizationSource = readFileSync(
  new URL('../app/composables/useAuthorization.ts', import.meta.url),
  'utf8'
)

describe('authorization SSR request context', () => {
  test('forwards the incoming request context when loading the local permissions API', () => {
    assert.match(
      authorizationSource,
      /if \(import\.meta\.server\) \{[\s\S]*useRequestFetch\(\)[\s\S]*\} else \{[\s\S]*\$fetch/
    )
    assert.match(
      authorizationSource,
      /type AuthorizationSnapshotResponse = \{/
    )
    assert.match(authorizationSource, /const response = await requestFetch\('\/api\/auth\/permissions'\)/)
  })
})
