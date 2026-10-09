import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, test } from 'node:test'
import { createEvent } from 'h3'
import { startConsoleOidcLogin, handleConsoleOidcCallback } from '../server/utils/consoleOidc'
import { createConsoleOidcTransientCookieNames } from '../server/utils/consoleOidcFlow'

const globals = globalThis as { useRuntimeConfig?: () => unknown }
const original = globals.useRuntimeConfig
afterEach(() => {
  globals.useRuntimeConfig = original
})
function eventFor(url: string, cookie = '') {
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { consoleOidc: { issuer: 'https://example.test/console', redirectUri: 'https://example.test/enterprise/api/auth/callback' } } })
  const req = new IncomingMessage(new Socket())
  req.headers = { 'host': 'example.test', cookie, 'x-forwarded-proto': 'https' }
  req.url = url
  req.method = 'GET'
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), res }
}
function cookies(res: ServerResponse) {
  return ([] as string[]).concat(res.getHeader('set-cookie') as string[] || [])
}

test('login prunes abandoned states, caps redirect and TTL, and scopes cookies to the app', async () => {
  const old = ['A', 'B', 'C'].map(c => Object.values(createConsoleOidcTransientCookieNames('enterprise', c.repeat(32))))
  const { event, res } = eventFor('/enterprise/api/auth/login?redirect=' + encodeURIComponent('/' + 'x'.repeat(5000)), old.flat().map(name => `${name}=synthetic`).join('; '))
  await startConsoleOidcLogin(event)
  const set = cookies(res)
  for (const name of old[0]!) assert.ok(set.some(c => c.startsWith(`${name}=;`) && c.includes('Path=/enterprise')))
  const live = set.filter(c => !c.includes('Max-Age=0'))
  assert.equal(live.length, 4)
  for (const c of live) {
    assert.match(c, /Path=\/enterprise/)
    assert.match(c, /Max-Age=600/)
    assert.match(c, /HttpOnly/)
    assert.ok(Buffer.byteLength(c) < 4096)
  }
  assert.ok(live.some(c => /^hzy_enterprise_oidc_redirect_[^=]+=%2F;/.test(c)))
})

test('invalid or provider-error callbacks clear temporary cookies before rejecting, never sessions', async () => {
  const state = 'A'.repeat(32)
  const names = createConsoleOidcTransientCookieNames('enterprise', state)
  for (const query of [`state=${state}&error=access_denied`, `state=${state}&code=bad`]) {
    const { event, res } = eventFor(`/enterprise/api/auth/callback?${query}`, `${names.state}=mismatched`)
    await assert.rejects(handleConsoleOidcCallback(event), /Invalid Console OIDC callback state/)
    for (const name of Object.values(names)) {
      assert.ok(cookies(res).some(c => c.startsWith(`${name}=;`) && c.includes('Path=/enterprise') && c.includes('Max-Age=0')))
    }
    assert.ok(cookies(res).every(c => !c.startsWith('hzy_enterprise_access_token=')))
  }
})
