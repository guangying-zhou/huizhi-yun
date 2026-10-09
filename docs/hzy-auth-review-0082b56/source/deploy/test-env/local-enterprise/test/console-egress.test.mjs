import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { createConsoleEgress, allowedConsoleRequest } from '../console-egress.mjs'

const tokenBody = { grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'data-runtime', scope: 'aims:products:view', source_binding: 'service-client-policy' }
test('egress permits exact Enterprise reads and rejects writes or identity overrides', () => {
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(tokenBody)), true)
  for (const changed of [{ client_id: 'console.runtime' }, { app_code: 'aims' }, { scope: 'aims:products:edit' }, { audience: 'tenant-runtime' }, { deployment: 'other' }, { scope: 'aims:products:view aims:projects:view' }]) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, ...changed })), false)
  }
  assert.equal(allowedConsoleRequest('POST', '/api/v1/console/service/business-domains', '{}'), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/vault'), false)
})

test('approved product write retains exact scope, audience and identity restrictions', () => {
  const approved = { ...tokenBody, scope: 'assets:product:edit' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  for (const changed of [
    { audience: 'console' }, { audience: 'tenant-runtime' },
    { scope: 'assets:product:admin' }, { scope: 'codocs:personal-documents:create' },
    { scope: 'assets:product:edit assets:product:read' },
    { client_id: 'assets.runtime' }, { app_code: 'assets' },
    { source_binding: 'untrusted' }, { tenant: 'other' }, { deployment: 'other' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
})

test('authenticated loopback transport pins remote origin/context', async () => {
  const calls = []
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture', fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ access_token: 'fixture-access' }), { headers: { 'content-type': 'application/json' } })
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const call = (path, key, body = JSON.stringify(tokenBody)) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'x-hzy0-egress-token': key, 'x-hzy-tenant': 'forged', 'x-hzy-gateway-token': 'forged', 'x-forwarded-host': 'evil.test' } }, res => {
      let body = ''; res.on('data', c => { body += c }); res.on('end', () => resolve({ status: res.statusCode, body }))
    }); req.on('error', reject); req.end(body)
  })
  try {
    for (const key of ['', 'wrong']) assert.equal((await call('/oauth/token', key)).status, 401)
    for (const path of ['https://evil.test/oauth/token', '//evil.test/oauth/token', '/api/v1/console/vault', '/%6fauth/token']) assert.equal((await call(path, 'local-fixture')).status, 403)
    assert.equal(calls.length, 0)
    assert.equal((await call('/oauth/token', 'local-fixture')).status, 200)
    assert.equal(calls[0].url.origin, 'https://hzy-test.huizhi.yun')
    assert.equal(calls[0].init.redirect, 'error')
    assert.equal(calls[0].init.headers.get('x-hzy-gateway-token'), 'remote-fixture')
    assert.equal(calls[0].init.headers.get('x-hzy-tenant'), 'C000001')
    assert.equal(calls[0].init.headers.has('x-hzy0-egress-token'), false)
    assert.equal(calls[0].init.headers.has('x-forwarded-host'), false)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('upstream diagnostic bodies and headers are never relayed', async () => {
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture', fetchImpl: async () =>
    new Response('remote-fixture', { status: 403, headers: { 'x-secret': 'remote-fixture' } }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/userinfo`, { headers: { 'x-hzy0-egress-token': 'local-fixture' } })
    assert.equal(response.status, 403)
    assert.equal(response.headers.has('x-secret'), false)
    assert.doesNotMatch(await response.text(), /remote-fixture/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
