import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const authorizationSource = readFileSync(
  new URL('../app/composables/useAuthorization.ts', import.meta.url),
  'utf8'
)

describe('authorization SSR request context', () => {
  test('forwards the incoming request context and uses the Host-local permissions path', () => {
    assert.match(
      authorizationSource,
      /if \(import\.meta\.server\) \{[\s\S]*useRequestFetch\(\)[\s\S]*\} else \{[\s\S]*\$fetch/
    )
    assert.match(
      authorizationSource,
      /type AuthorizationSnapshotResponse = \{/
    )
    assert.match(
      authorizationSource,
      /const authPrefix = publicConfig\.appCode === 'enterprise' && publicConfig\.authApiPrefix === '\/enterprise' \? '\/enterprise' : ''/
    )
    assert.match(authorizationSource, /const response = await requestFetch\(`\$\{authPrefix\}\/api\/auth\/permissions`\)/)
  })
})
