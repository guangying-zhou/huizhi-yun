import assert from 'node:assert/strict'
import test from 'node:test'
import { callbackPatch, loginCallback, logoutCallback } from '../sso-facade-callbacks.mjs'

const fixture = () => ({ clientId: 'hzy_local_console', protocol: 'openid-connect', publicClient: false,
  enabled: true, standardFlowEnabled: true, redirectUris: ['https://existing.test/callback'],
  webOrigins: ['https://existing.test'], attributes: { 'pkce.code.challenge.method': 'S256',
    'post.logout.redirect.uris': 'https://existing.test/logout' } })
test('only adds two exact callbacks; preserves origins, PKCE and old callbacks; idempotent', () => {
  const before = fixture(), original = structuredClone(before), patch = callbackPatch(before)
  assert.deepEqual(before, original)
  assert.deepEqual(Object.keys(patch), ['redirectUris', 'attributes'])
  assert.deepEqual(patch.redirectUris, [...before.redirectUris, loginCallback])
  assert.equal(patch.attributes['post.logout.redirect.uris'], `https://existing.test/logout##${logoutCallback}`)
  assert.equal(patch.attributes['pkce.code.challenge.method'], 'S256')
  assert.deepEqual(callbackPatch({ ...before, ...patch }), patch)
})
test('rejects unexpected client and flow configuration', () => {
  for (const change of [{ clientId: 'other' }, { publicClient: true }, { enabled: false },
    { standardFlowEnabled: false }, { protocol: 'saml' }, { redirectUris: undefined }]) {
    assert.throws(() => callbackPatch({ ...fixture(), ...change }))
  }
})
