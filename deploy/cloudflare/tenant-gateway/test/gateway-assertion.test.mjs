import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto'
import gateway from '../src/index.js'
import { signGatewayAssertion, gatewayAssertionSourceEnabled } from '../src/gateway-assertion.js'

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const env = {
    HZY_GATEWAY_ASSERTION_ENABLED: 'true',
    HZY_GATEWAY_ASSERTION_SOURCE_APPS: 'enterprise',
    HZY_GATEWAY_ASSERTION_IDENTITY_JSON: JSON.stringify({ deploymentCode: 'test-gateway', tenantCode: 'test-tenant', environment: 'test' }),
    HZY_GATEWAY_ASSERTION_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })),
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-internal',
    HZY_CONSOLE_ORIGIN: 'https://console.invalid',
    HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'tenant.test': {
      tenantCode: 'test-tenant', deploymentCode: 'test-console', environment: 'test',
      dataRuntime: { runtimeCode: 'test-runtime', endpoint: 'https://runtime.invalid', audience: 'data-runtime' },
      apps: { console: { deploymentCode: 'test-console' }, enterprise: { deploymentCode: 'test-enterprise' } }
    } } })
  }
  return { env, publicKey }
}
function request(overrides = {}, headers = {}) {
  return new Request('https://tenant.test/oauth/token', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': 'fixture-internal', 'x-hzy-app-code': 'enterprise',
    'x-hzy-tenant': 'test-tenant', 'x-hzy-environment': 'test', 'x-hzy-deployment': 'test-enterprise',
    // All these attacker/caller-controlled values must disappear.
    'x-hzy-gateway-service-assertion': 'forged-proof', 'x-hzy-gateway-deployment': 'forged-gateway',
    'x-hzy-gateway-future-proof': 'forged', 'x-hzy-data-runtime-code': 'forged-runtime',
    'x-hzy-actor-uid': 'forged-actor', 'x-hzy-scheduler': 'tenant-gateway',
    'x-hzy-console-target-deployment': 'forged-console', cookie: 'session=forged', 'x-custom-secret': 'forged',
    ...headers
  }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: 'enterprise.runtime',
    audience: 'data-runtime', scope: 'aims:projects:view aims:projects:edit aims:projects:view',
    source_binding: 'trusted-gateway', app_code: 'enterprise', ...overrides }) })
}
function unpack(raw, publicKey) {
  const [header, payload, signature] = raw.split('.')
  assert.equal(verify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true)
  return { header: JSON.parse(Buffer.from(header, 'base64url')), claims: JSON.parse(Buffer.from(payload, 'base64url')) }
}
test('Gateway signs registry source facts, fresh nonce, canonical scope and fixed-purpose 60s JWT', async () => {
  const { env, publicKey } = fixture()
  const calls = []
  env.HZY_CONSOLE_SERVICE = { async fetch(url, init) {
    calls.push(init)
    const { header, claims } = unpack(init.headers.get('x-hzy-gateway-service-assertion'), publicKey)
    assert.equal(header.alg, 'EdDSA'); assert.equal(header.typ, 'hzy-gateway-service-assertion+jwt')
    assert.match(header.kid, /^[a-f0-9]{64}$/)
    assert.equal(claims.tenant, 'test-tenant'); assert.equal(claims.environment, 'test')
    assert.equal(claims.gateway_deployment, 'test-gateway'); assert.equal(claims.runtime_code, 'test-runtime')
    assert.equal(claims.source_app, 'enterprise'); assert.equal(claims.source_deployment, 'test-enterprise')
    assert.equal(claims.client_id, 'enterprise.runtime'); assert.equal(claims.oauth_audience, 'data-runtime')
    assert.equal(claims.scope, 'aims:projects:edit aims:projects:view')
    assert.equal(claims.iss, 'gateway:test-gateway'); assert.equal(claims.sub, claims.iss)
    assert.equal(claims.aud, '/v1/console/auth/service-tokens/gateway-exchange')
    assert.equal(claims.path, claims.aud); assert.equal(claims.method, 'POST')
    assert.equal(claims.source_binding, 'trusted-gateway')
    assert.equal(claims.iat, claims.nbf); assert.equal(claims.exp - claims.iat, 60)
    assert.equal(Buffer.from(claims.jti, 'base64url').length, 16)
    assert.equal(init.headers.get('x-hzy-gateway-deployment'), 'test-gateway')
    assert.equal(init.headers.get('x-hzy-data-runtime-code'), 'test-runtime')
    assert.equal(init.headers.get('x-hzy-app-code'), 'enterprise')
    assert.equal(init.headers.get('x-hzy-deployment'), 'test-enterprise')
    for (const name of ['cookie', 'authorization', 'x-hzy-actor-uid', 'x-hzy-scheduler', 'x-custom-secret', 'x-hzy-gateway-future-proof', 'x-hzy-console-target-deployment']) assert.equal(init.headers.has(name), false)
    return Response.json({ access_token: 'fixture-response' })
  } }
  for (let i = 0; i < 2; i++) assert.equal((await gateway.fetch(request(), env)).status, 200)
  assert.equal(calls.length, 2)
  assert.notEqual(unpack(calls[0].headers.get('x-hzy-gateway-service-assertion'), publicKey).claims.jti,
    unpack(calls[1].headers.get('x-hzy-gateway-service-assertion'), publicKey).claims.jti)
})
test('Gateway uses exactly one legacy call only for dedicated 503; security failures never fall back', async () => {
  for (const [status, code, fallback] of [[503, 'gateway_keyset_unavailable', true], [401, 'gateway_assertion_invalid', false],
    [401, 'gateway_assertion_replayed', false], [403, 'insufficient_scope', false], [403, 'gateway_assertion_key_invalid', false],
    [503, 'gateway_exchange_disabled', false], [503, 'gateway_keyset_invalid', false], [503, 'gateway_replay_storage_unavailable', false],
    [500, 'gateway_keyset_unavailable', false], [503, 'internal_error', false], [403, 'gateway_keyset_unavailable', false]]) {
    const { env } = fixture(); const calls = []
    env.HZY_CONSOLE_SERVICE = { async fetch(url, init) {
      calls.push(init)
      if (calls.length === 1) return Response.json({ data: { code } }, { status })
      assert.equal(init.headers.has('x-hzy-gateway-service-assertion'), false)
      assert.equal(init.headers.has('x-hzy-gateway-deployment'), false)
      assert.equal(init.headers.get('x-hzy-app-code'), 'enterprise')
      assert.equal(init.body, calls[0].body)
      return Response.json({ access_token: 'fixture-legacy' })
    } }
    const response = await gateway.fetch(request(), env)
    assert.equal(response.status, fallback ? 200 : status, code)
    assert.equal(calls.length, fallback ? 2 : 1, code)
  }
  const { env } = fixture(); let calls = 0
  env.HZY_CONSOLE_SERVICE = { async fetch() { calls++; throw new Error('simulated network error') } }
  assert.equal((await gateway.fetch(request(), env)).status, 503)
  assert.equal(calls, 1)
})
test('default off, credential, untrusted browser and non-token paths strip proof and retain old transport', async () => {
  for (const mode of ['off', 'credential', 'browser', 'basic', 'non-token']) {
    const { env } = fixture(); let called = 0
    if (mode === 'off') delete env.HZY_GATEWAY_ASSERTION_ENABLED
    env.HZY_CONSOLE_SERVICE = { async fetch(url, init) {
      called++
      assert.equal(init.headers.has('x-hzy-gateway-service-assertion'), false)
      assert.equal(init.headers.has('x-hzy-gateway-deployment'), false)
      assert.equal(init.headers.has('x-hzy-gateway-future-proof'), false)
      return Response.json({ old: true })
    } }
    let input = request(mode === 'credential' ? { client_secret: 'fixture-secret' } : {},
      mode === 'browser' ? { 'x-hzy-gateway-token': 'forged' } : mode === 'basic' ? { authorization: 'Basic Zml4dHVyZQ==' } : {})
    if (mode === 'non-token') input = new Request('https://tenant.test/api/test', input)
    assert.equal((await gateway.fetch(input, env)).status, 200)
    assert.equal(called, 1)
  }
})
test('invalid registration/config/source/binding/request fails before Console without fallback', async () => {
  for (const mode of ['tenant', 'environment', 'key', 'mismatch-key', 'body-app', 'scope', 'source-binding', 'unknown-source', 'deployment', 'missing-runtime', 'missing-binding']) {
    const { env } = fixture(); let called = 0
    env.HZY_CONSOLE_SERVICE = { async fetch() { called++; throw new Error('must not forward') } }
    const identity = JSON.parse(env.HZY_GATEWAY_ASSERTION_IDENTITY_JSON)
    if (mode === 'tenant') identity.tenantCode = 'other'
    if (mode === 'environment') identity.environment = 'prod'
    env.HZY_GATEWAY_ASSERTION_IDENTITY_JSON = JSON.stringify(identity)
    if (mode === 'key') env.HZY_GATEWAY_ASSERTION_PRIVATE_JWK = '{}'
    if (mode === 'mismatch-key') {
      const key = JSON.parse(env.HZY_GATEWAY_ASSERTION_PRIVATE_JWK)
      key.x = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x
      env.HZY_GATEWAY_ASSERTION_PRIVATE_JWK = JSON.stringify(key)
    }
    if (mode === 'missing-runtime') {
      const registry = JSON.parse(env.HZY_TENANT_GATEWAY_REGISTRY_JSON)
      delete registry.domains['tenant.test'].dataRuntime.runtimeCode
      env.HZY_TENANT_GATEWAY_REGISTRY_JSON = JSON.stringify(registry)
    }
    if (mode === 'missing-binding') delete env.HZY_CONSOLE_SERVICE
    const response = await gateway.fetch(request(mode === 'body-app' ? { app_code: 'people' }
      : mode === 'scope' ? { scope: '' } : mode === 'source-binding' ? { source_binding: 'service-client-policy' } : {},
    mode === 'unknown-source' ? { 'x-hzy-app-code': 'unknown' } : mode === 'deployment' ? { 'x-hzy-deployment': 'forged' } : {}), env)
    assert.ok(response.status >= 400, mode); assert.equal(called, 0, mode)
  }
})
test('kid derives from registered public key and key import never exports private material', async () => {
  const { env } = fixture()
  const key = JSON.parse(env.HZY_GATEWAY_ASSERTION_PRIVATE_JWK)
  const signed = await signGatewayAssertion(env, { tenant: 'test-tenant', environment: 'test', runtimeCode: 'test-runtime', appCode: 'enterprise', deployment: 'test-enterprise' }, { clientId: 'enterprise.runtime', audience: 'tenant-runtime', scope: 'aims:projects:view' }, 1700000000000)
  const publicKey = createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x }, format: 'jwk' })
  const { claims } = unpack(signed.assertion, publicKey)
  assert.equal(claims.iat, 1700000000)
})


test('malformed or oversized token JSON is rejected with no forwarding', async () => {
  for (const body of ['{', JSON.stringify({ grant_type: 'client_credentials', scope: 'x'.repeat(65536) })]) {
    const { env } = fixture()
    let called = 0
    env.HZY_CONSOLE_SERVICE = { async fetch() { called++; throw new Error('must not forward') } }
    const input = new Request(request(), { body })
    const response = await gateway.fetch(input, env)
    assert.equal(response.status, 400)
    assert.equal(called, 0)
  }
})

test('source rollout defaults off and matches only exact verified registry app facts', async () => {
  for (const list of [undefined, '', '*', 'enterprise,*', 'enterprise,', 'Enterprise', 'enter', 'enterprise-other', 'console']) {
    const { env } = fixture()
    env.HZY_GATEWAY_ASSERTION_SOURCE_APPS = list
    env.HZY_GATEWAY_ASSERTION_PRIVATE_JWK = 'invalid-unused-key'
    assert.equal(gatewayAssertionSourceEnabled(env, 'enterprise'), false)
    let calls = 0
    env.HZY_CONSOLE_SERVICE = { async fetch(url, init) {
      calls++
      assert.equal(init.headers.has('x-hzy-gateway-service-assertion'), false)
      return Response.json({ legacy: true })
    } }
    assert.equal((await gateway.fetch(request(), env)).status, 200)
    assert.equal(calls, 1)
  }
  const { env } = fixture()
  env.HZY_GATEWAY_ASSERTION_SOURCE_APPS = ' enterprise , console '
  assert.equal(gatewayAssertionSourceEnabled(env, 'enterprise'), true)
  assert.equal(gatewayAssertionSourceEnabled(env, 'console'), true)
  assert.equal(gatewayAssertionSourceEnabled(env, 'aims'), false)
  assert.equal(gatewayAssertionSourceEnabled(env, undefined), false)
  env.HZY_GATEWAY_ASSERTION_ENABLED = 'false'
  assert.equal(gatewayAssertionSourceEnabled(env, 'enterprise'), false)
})
