import test from 'node:test'
import assert from 'node:assert/strict'
import localGateway, { runtimeBinding } from '../worker-gateway.mjs'
import { gatewayConfig } from '../worker-config.mjs'

function env() {
  return { ...gatewayConfig().vars, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'local-test-secret',
    HZY_CONSOLE_SERVICE: { fetch: async () => new Response('console') },
    HZY_PEOPLE_SERVICE: { fetch: async () => new Response('people') } }
}
test('local Runtime adapter preserves binding transport and rejects mismatched trust', async () => {
  let calls = 0
  const binding = runtimeBinding({ fetch: async r => { calls++; return new Response(r.headers.get('x-hzy-data-runtime-url')) } }, 'secret', 'people')
  const headers = { 'x-hzy-data-runtime-url': 'https://local-runtime.invalid', 'x-hzy-gateway-token': 'secret',
    'x-hzy-tenant': 'C000001', 'x-hzy-environment': 'test', 'x-hzy-deployment': 'C000001-test-people' }
  assert.equal(await (await binding.fetch('https://people.local.invalid', { headers })).text(), 'http://127.0.0.1:18080')
  for (const key of ['x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-environment', 'x-hzy-deployment']) {
    assert.equal((await binding.fetch('https://people.local.invalid', { headers: { ...headers, [key]: 'wrong' } })).status, 403)
  }
  assert.equal(calls, 1)
})
test('missing bindings and unknown hosts fail closed', async () => {
  assert.equal((await localGateway.fetch(new Request('http://127.0.0.1/'), {})).status, 503)
  assert.equal((await localGateway.fetch(new Request('https://untrusted.test/'), env())).status, 403)
})
test('Console token exchange preserves trusted People caller only on exact token POST', async () => {
  const binding = runtimeBinding({ fetch: async r => new Response(r.headers.get('x-hzy-data-runtime-url')) }, 'secret', 'console')
  const headers = { 'x-hzy-data-runtime-url': 'https://local-runtime.invalid', 'x-hzy-gateway-token': 'secret',
    'x-hzy-tenant': 'C000001', 'x-hzy-environment': 'test', 'x-hzy-app-code': 'people', 'x-hzy-deployment': 'C000001-test-people' }
  assert.equal(await (await binding.fetch('https://console.test/oauth/token', { method: 'POST', headers })).text(), 'http://127.0.0.1:18080')
  for (const [path, method] of [['/oauth/token', 'GET'], ['/api/auth/me', 'POST']]) {
    assert.equal((await binding.fetch(`https://console.test${path}`, { method, headers })).status, 403)
  }
  for (const key of ['x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-environment', 'x-hzy-app-code', 'x-hzy-deployment']) {
    assert.equal((await binding.fetch('https://console.test/oauth/token', { method: 'POST', headers: { ...headers, [key]: 'wrong' } })).status, 403)
  }
})
test('disabled apps/connector cannot fall back to production; RUM is an explicit local sink', async () => {
  for (const path of ['/finance/x', '/collab/ws', '/directory-connector/oauth/token']) {
    assert.equal((await localGateway.fetch(new Request(`http://127.0.0.1${path}`), env())).status, 503)
  }
  for (const path of ['/rum', '/api/rum', '/cdn-cgi/rum']) {
    assert.equal((await localGateway.fetch(new Request(`http://127.0.0.1${path}`), env())).status, 204)
  }
})
test('real production Gateway routes smoke HTML but does not claim working auth', async () => {
  assert.equal(await (await localGateway.fetch(new Request('http://127.0.0.1/'), env())).text(), 'console')
  assert.equal(await (await localGateway.fetch(new Request('http://127.0.0.1/people/employees'), env())).text(), 'people')
  assert.equal((await localGateway.fetch(new Request('http://127.0.0.1/people/api/auth/permissions'), env())).status, 503)
})
test('loopback ingress port and spoofed forwarding host never enter public issuer', async () => {
  const e = env()
  e.HZY_CONSOLE_SERVICE = { fetch: async (_input, init) => new Response(init.headers.get('x-forwarded-host')) }
  assert.equal(await (await localGateway.fetch(new Request('http://127.0.0.1:19090/', {
    headers: { 'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'http' }
  }), e)).text(), 'hzy0.isme.dev')
})
