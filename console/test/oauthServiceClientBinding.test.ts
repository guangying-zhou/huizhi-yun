import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { serviceTokenSourceBindingForCredential } from '../server/utils/serviceTokenSourceBinding.ts'

test('OAuth client credentials always use their verified grant policy binding', () => {
  assert.equal(serviceTokenSourceBindingForCredential('client-secret'), 'service-client-policy')
  assert.equal(serviceTokenSourceBindingForCredential(''), 'trusted-gateway')
  assert.equal(
    serviceTokenSourceBindingForCredential('', 'service-client-policy'),
    'service-client-policy'
  )
  assert.equal(
    serviceTokenSourceBindingForCredential('', 'attacker-selected-deployment'),
    'trusted-gateway'
  )

  const route = readFileSync(
    new URL('../server/routes/oauth/token.post.ts', import.meta.url),
    'utf8'
  )
  assert.match(route, /consumeRuntimeAppIdentity/)
  assert.match(
    route,
    /serviceTokenSourceBindingForCredential\(\s*clientSecret,\s*clientSecret \? undefined : body\.source_binding\s*\)/
  )
  assert.doesNotMatch(route, /deployment(?:Code)?\s*:\s*body\./)
})
