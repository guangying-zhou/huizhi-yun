import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPolicyStorageToken } from '../server/utils/policyStorageToken.ts'

test('only precise Runtime policy storage capabilities skip optional bundle digest', () => {
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const scope of ['console:policy-bundle:read', 'console:policy-bundle:write', 'console:policy-bundle:read console:policy-bundle:write']) {
      assert.equal(isPolicyStorageToken(audience, scope), true)
    }
    for (const scope of ['', 'console.read', 'console:policy-bundle:admin', 'console:policy-bundle:read console:auth-oidc:sign']) {
      assert.equal(isPolicyStorageToken(audience, scope), false)
    }
  }
  assert.equal(isPolicyStorageToken('people', 'console:policy-bundle:read'), false)
})
