import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapOutage, createConsoleFacade } from '../console-facade.mjs'
import { createConsoleEgress } from '../console-egress.mjs'
import { SERVICE_KEY_EGRESS_PATH, SERVICE_KEY_URL, createPolicyDelivery, createPolicyWake } from '../policy-sync.mjs'

// R1 steady Console identity in hzy0: when Platform is unreachable the Gateway
// tells Console (trusted headers) instead of failing, and Console registers its
// key through the fixed credentialed egress.
const tenant = { tenantCode: 'C000001', environment: 'test', apps: {
  console: { deploymentCode: 'wiztek-test-console' }, enterprise: { deploymentCode: 'C000001-test-enterprise' }
}, dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev', runtimeCode: 'c000001-test-tenant-runtime' },
login: { mode: 'oidc', enabledProviders: ['oidc'], oidc: { issuer: 'https://sso.wiztek.cn/realms/wiztek', clientId: 'hzy_local_console', clientSecret: 'sso-fixture' } } }
const claims = { iss: 'https://hzy.wiztek.cn', aud: 'data-runtime-bootstrap', tenant: 'C000001', deployment: 'wiztek-test-console',
  runtimeCode: 'c000001-test-tenant-runtime', token_use: 'platform_runtime_bootstrap', exp: Math.floor(Date.now() / 1000) + 90 }
const token = `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`
const publicKey = 'A'.repeat(43)
const registration = JSON.stringify({ environment: 'test', deploymentCode: 'wiztek-test-console', publicKey })

function facadeWith(bootstrap, fault = () => null) {
  let calls = 0
  const facade = createConsoleFacade({ localSecret: 'local-fixture', credentials: { HZY_PLATFORM_INTERNAL_TOKEN: 'platform-fixture' },
    registryVars: { HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/resolve' }, tenant, fault,
    fetchImpl: async (url) => {
      if (String(url).includes('runtime-bootstrap-token')) {
        calls++
        return bootstrap()
      }
      return Response.json({ ok: true })
    } })
  return { facade, get calls() { return calls } }
}
const request = (headers = {}) => new Request('https://hzy0.isme.dev/console/api/x', { headers })

test('bootstrap outage classification: only unreachable Platform, never a refusal or bad response', () => {
  for (const status of [500, 502, 503, 504, 408, 429]) assert.equal(bootstrapOutage(Error(`Platform runtime bootstrap token failed: ${status}`)), true)
  for (const status of [400, 401, 403, 404, 409]) assert.equal(bootstrapOutage(Error(`Platform runtime bootstrap token failed: ${status}`)), false)
  assert.equal(bootstrapOutage(new TypeError('fetch failed')), true)
  assert.equal(bootstrapOutage(Object.assign(Error('timeout'), { name: 'TimeoutError' })), true)
  assert.equal(bootstrapOutage(Error('Platform runtime bootstrap token response is invalid')), false)
  assert.equal(bootstrapOutage(Error('Platform runtime bootstrap token response is too short-lived')), false)
})

test('the facade marks a Platform outage instead of failing; refusals still fail and spoofed markers are dropped', async () => {
  const down = facadeWith(() => new Response('down', { status: 503 }))
  const headers = await down.facade.headers(request())
  assert.equal(headers.get('x-hzy-runtime-bootstrap-unavailable'), 'platform')
  assert.equal(headers.has('x-hzy-data-runtime-token'), false)
  assert.equal(headers.get('x-hzy-gateway-token'), 'local-fixture')
  assert.equal(headers.get('x-hzy-deployment'), 'wiztek-test-console')

  const refused = facadeWith(() => new Response('no', { status: 409 }))
  await assert.rejects(refused.facade.headers(request()))

  const healthy = facadeWith(() => Response.json({ data: { token, expiresAt: new Date(claims.exp * 1000).toISOString() } }))
  const normal = await healthy.facade.headers(request({ 'x-hzy-runtime-bootstrap-unavailable': 'platform' }))
  assert.equal(normal.get('x-hzy-data-runtime-token'), token)
  assert.equal(normal.has('x-hzy-runtime-bootstrap-unavailable'), false, 'a caller cannot claim an outage')

  const simulated = facadeWith(() => Response.json({ data: { token, expiresAt: new Date(claims.exp * 1000).toISOString() } }), () => 'platform-down')
  assert.equal((await simulated.facade.headers(request())).get('x-hzy-runtime-bootstrap-unavailable'), 'platform')
  assert.equal(simulated.calls, 0, 'the acceptance switch never contacts Platform')
  const policyOnly = facadeWith(() => Response.json({ data: { token, expiresAt: new Date(claims.exp * 1000).toISOString() } }), () => 'unavailable')
  assert.equal((await policyOnly.facade.headers(request())).get('x-hzy-data-runtime-token'), token, "'unavailable' only affects policy delivery")
})

test('the policy wake carries the outage marker to Console', async () => {
  let headers
  await createPolicyWake({ tenant, localSecret: 'fixture-key',
    facade: { headers: async () => new Headers({ 'x-hzy-runtime-bootstrap-unavailable': 'platform' }) },
    fetchImpl: async (_url, init) => { headers = init.headers; return Response.json({ code: 0, data: { ready: true } }) } })()
  assert.equal(headers.get('x-hzy-runtime-bootstrap-unavailable'), 'platform')
  assert.equal(headers.has('x-hzy-data-runtime-token'), false)
})

test('service key registration: fixed target, exact body, fault switch honoured', async () => {
  const calls = []
  let fault = null
  const deliver = createPolicyDelivery({ platformToken: 'platform-fixture', fault: () => fault,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json({ data: { kid: 'csk_0123456789abcdef' } }) } })
  assert.equal((await deliver.registerServiceKey(registration)).status, 200)
  assert.equal(calls[0].url, SERVICE_KEY_URL)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body, registration)
  assert.equal(calls[0].init.headers.authorization, 'Bearer platform-fixture')
  for (const body of ['{}', 'x', JSON.stringify({ environment: 'prod', deploymentCode: 'wiztek-test-console', publicKey }),
    JSON.stringify({ environment: 'test', deploymentCode: 'other', publicKey }), JSON.stringify({ environment: 'test', deploymentCode: 'wiztek-test-console', publicKey, extra: 1 })]) {
    assert.equal((await deliver.registerServiceKey(body)).status, 400)
  }
  for (const [value, status] of [['platform-down', 503], ['unavailable', 503], ['refused', 403]]) {
    fault = value
    assert.equal((await deliver.registerServiceKey(registration)).status, status)
  }
  assert.equal(calls.length, 1)
})

test('private egress forwards only authenticated, bounded registration posts and keeps Platform status', async () => {
  let reply = () => Response.json({ data: { kid: 'csk_0123456789abcdef' } })
  const bodies = []
  const policyFetch = Object.assign(() => Response.json({}), { registerServiceKey: async body => { bodies.push(body); return reply() } })
  const server = createConsoleEgress({ localSecret: 'local', remoteSecret: 'remote', policyFetch })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}${SERVICE_KEY_EGRESS_PATH}`
  const post = (options = {}) => fetch(url, { method: 'POST', body: registration, headers: { 'x-hzy0-egress-token': 'local' }, ...options })
  try {
    assert.equal((await post({ headers: {} })).status, 401)
    assert.equal((await fetch(url, { headers: { 'x-hzy0-egress-token': 'local' } })).status, 403)
    assert.equal((await post({ body: 'x'.repeat(2048) })).status, 413)
    const ok = await post()
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { data: { kid: 'csk_0123456789abcdef' } })
    assert.deepEqual(bodies.slice(-1), [registration])
    reply = () => new Response(null, { status: 503 })
    assert.equal((await post()).status, 503)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('a successful registration makes the next wake prepare the full envelope', async () => {
  const fetched = []
  let time = 1_000_000
  const deliver = createPolicyDelivery({ platformToken: 'fixture', now: () => time, fetchImpl: async (url, init) => {
    fetched.push(String(url))
    if (init?.method === 'POST') return Response.json({ data: { kid: 'csk_0123456789abcdef' } })
    return Response.json(String(url).includes('revision') ? { data: { policyRevision: 3, payloadHash: 'sha256_a', status: 'active' } } : { signed: true })
  } })
  await deliver.prepare()
  deliver.confirm(time + 15 * 60_000)
  fetched.length = 0
  time += 60_000
  assert.equal((await deliver.prepare()).full, false, 'unchanged revision skips the envelope')
  await deliver.registerServiceKey(registration)
  deliver.confirm(time + 15 * 60_000)
  time += 60_000
  assert.equal((await deliver.prepare()).full, true, 'the envelope carrying the new key is fetched')
})

test('an envelope request the wake did not prepare makes the next wake prepare it', async () => {
  let time = 1_000_000
  const deliver = createPolicyDelivery({ platformToken: 'fixture', now: () => time, fetchImpl: async url =>
    Response.json(String(url).includes('revision') ? { data: { policyRevision: 3, payloadHash: 'sha256_a', status: 'active' } } : { signed: true }) })
  await deliver.prepare()
  deliver.confirm(time + 15 * 60_000)
  time += 60_000
  assert.equal((await deliver.prepare()).full, false)
  assert.throws(() => deliver('envelope'))
  deliver.confirm(time + 15 * 60_000)
  time += 60_000
  assert.equal((await deliver.prepare()).full, true)
})
