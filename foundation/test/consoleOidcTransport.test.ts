import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { H3Event } from 'h3'
import { consoleServiceFetch, consoleServiceBinding } from '../server/utils/consoleServiceBinding'

test('server-installed local transport is opt-in and ignores browser header substitutes', () => {
  const previous = process.env.HZY0_LOCAL_ENTERPRISE
  const transport = { fetch: async () => Response.json({}) }
  try {
    delete process.env.HZY0_LOCAL_ENTERPRISE
    const event = { context: { hzyConsoleTransport: transport } } as unknown as H3Event
    assert.equal(consoleServiceBinding(event), null)
    process.env.HZY0_LOCAL_ENTERPRISE = 'true'
    assert.equal(consoleServiceBinding(event), transport)
    assert.equal(consoleServiceBinding({ context: {}, headers: { hzyConsoleTransport: transport } } as unknown as H3Event), null)
  } finally {
    if (previous === undefined) delete process.env.HZY0_LOCAL_ENTERPRISE
    else process.env.HZY0_LOCAL_ENTERPRISE = previous
  }
})

test('OIDC binding preserves form and caller context without public transport', async () => {
  let calls = 0
  const event = { context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: {
    async fetch(url: string, init: RequestInit) {
      calls++
      assert.equal(url, 'https://tenant.test/oauth/token')
      const headers = new Headers(init.headers)
      assert.equal(headers.get('x-hzy-app-code'), 'people')
      assert.equal(headers.get('x-hzy-deployment'), 'people-test')
      assert.equal(headers.get('x-forwarded-prefix'), '/people')
      assert.equal(headers.get('content-type'), 'application/x-www-form-urlencoded')
      assert.equal(new URLSearchParams(String(init.body)).get('code'), 'a+b&c')
      return Response.json({ access_token: 'test-only' })
    }
  } } } } } as unknown as H3Event
  const result = await consoleServiceFetch(event, 'https://tenant.test/console/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-hzy-app-code': 'people',
      'x-hzy-deployment': 'people-test', 'x-forwarded-prefix': '/people' },
    body: new URLSearchParams({ code: 'a+b&c' }).toString()
  })
  assert.deepEqual(result, { access_token: 'test-only' })
  assert.equal(calls, 1)
})

test('binding errors are not retried through the public origin', async () => {
  for (const status of [401, 403, 503]) {
    let calls = 0
    const event = { context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: {
      async fetch() {
        calls++
        return Response.json({ message: 'denied' }, { status })
      }
    } } } } } as unknown as H3Event
    await assert.rejects(consoleServiceFetch(event, 'https://tenant.test/oauth/userinfo'),
      (error: { statusCode?: number }) => error.statusCode === status)
    assert.equal(calls, 1)
  }
})

test('OIDC backchannel uses Binding while retaining fresh session and JWT checks', () => {
  const source = readFileSync(new URL('../server/utils/consoleOidc.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/consoleServiceFetch<ConsoleOidcTokenResponse>\(event/g) || []).length, 2)
  assert.match(source, /consoleServiceFetch<unknown>\(event, `\$\{endpointBaseUrl\}\/oauth\/userinfo`/)
  assert.match(source, /binding\.fetch\(normalizeConsoleServiceBindingUrl\(String\(input\)\)/)
  assert.match(source, /await validateConsoleOidcSession\(event, config, token\)/)
  assert.match(source, /audience: config.clientId/)
  assert.match(source, /createHash\('sha256'\).update\(JSON.stringify\(headers\)\)/)
  assert.doesNotMatch(source, /cached.headerState.value = headers/)
  assert.match(source, /trustedServiceRequestHeaders\(event, 'console'\)/)
})

test('userinfo owns authentication rather than repeating generic Console audience checks', () => {
  const middleware = readFileSync(new URL('../server/middleware/console-auth.ts', import.meta.url), 'utf8')
  assert.match(middleware, /\|\| pathname === '\/oauth\/userinfo'/)
  const handler = readFileSync(new URL('../../console/server/routes/oauth/userinfo.get.ts', import.meta.url), 'utf8')
  assert.match(handler, /if \(!token\)/)
  assert.match(handler, /await verifyAccessToken\(event, token\)/)
  const oidc = readFileSync(new URL('../../console/server/utils/oidc.ts', import.meta.url), 'utf8')
  const verification = oidc.split('export async function verifyAccessToken')[1]?.split('export async function')[0] || ''
  assert.match(verification, /await jwtVerify/)
  assert.match(verification, /payload.token_use !== 'access'/)
  assert.match(verification, /await resolveConsoleAuthSession/)
})
