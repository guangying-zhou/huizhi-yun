import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localApplicationCatalog, localRequestHeaders } from '../local-gateway.mjs'

test('local navigation rewrites only an already authorized People entry', () => {
  const payload = { code: 0, data: [{ appCode: 'people', homeUrl: 'https://test.example/people/', status: 'active' },
    { appCode: 'console', homeUrl: '/admin' }] }
  const local = localApplicationCatalog(payload)
  assert.equal(local.data[0].homeUrl, 'http://127.0.0.1:3007/people/')
  assert.equal(local.data[0].status, 'active')
  assert.deepEqual(local.data[1], payload.data[1])
  assert.equal(payload.data[0].homeUrl, 'https://test.example/people/')
  assert.deepEqual(localApplicationCatalog({ code: 0, data: [] }), { code: 0, data: [] })
  assert.deepEqual(localApplicationCatalog({ code: 1, data: payload.data }), { code: 1, data: payload.data })
})

test('local gateway strips forged context and pins test bindings and private transport', () => {
  const request = new Request('http://127.0.0.1:3007/people/api/auth/me', { headers: {
    'x-hzy-tenant': 'production', 'x-hzy-data-runtime-url': 'https://production.test', 'x-hzy-gateway-token': 'forged'
  } })
  const h = localRequestHeaders(request, 'people', 'fixture-secret', 'short-bootstrap')
  assert.equal(h.get('x-hzy-tenant'), 'C000001')
  assert.equal(h.get('x-hzy-deployment'), 'C000001-test-people')
  assert.equal(h.get('x-hzy-environment'), 'test')
  assert.equal(h.get('x-hzy-data-runtime-url'), 'http://127.0.0.1:18080')
  assert.equal(h.get('x-hzy-gateway-token'), 'fixture-secret')
})
test('source identity survives Console token proxy only with exact authenticated binding', () => {
  for (const [token, deployment, expected] of [['fixture-secret', 'C000001-test-people', 'people'],
    ['forged', 'C000001-test-people', 'console'], ['fixture-secret', 'C000001-people', 'console']]) {
    const req = new Request('http://127.0.0.1:3000/console/oauth/token', { method: 'POST', headers: {
      'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': token, 'x-hzy-tenant': 'C000001',
      'x-hzy-environment': 'test', 'x-hzy-app-code': 'people', 'x-hzy-deployment': deployment
    } })
    const h = localRequestHeaders(req, 'console', 'fixture-secret', 'short-bootstrap')
    assert.equal(h.get('x-hzy-app-code'), expected)
    assert.equal(h.get('x-hzy-deployment'), expected === 'people' ? 'C000001-test-people' : 'wiztek-test-console')
  }
})
test('gateway rejects alternate hosts, apps and internal scheduler paths', () => {
  for (const url of ['http://evil.test:3000/console/', 'http://127.0.0.1:3000/people/',
    'http://127.0.0.1:3000/console/api/internal/integration-operations/drain']) {
    assert.throws(() => localRequestHeaders(new Request(url), 'console', 'secret', 'bootstrap'))
  }
})
