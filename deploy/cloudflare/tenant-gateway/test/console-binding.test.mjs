import test from 'node:test'
import assert from 'node:assert/strict'
import gateway from '../src/index.js'

test('Console traffic uses its Binding and preserves sanitized target context', async () => {
  let called = 0
  const env = {
    HZY_CONSOLE_ORIGIN: 'https://console.invalid', HZY_CLOUDFLARE_INTERNAL_TOKEN: 'test-secret',
    HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'tenant.test': {
      tenantCode: 'test-tenant', deploymentCode: 'test-console', environment: 'test'
    } } }),
    HZY_CONSOLE_SERVICE: { async fetch(input, init) {
      called++
      assert.equal(new URL(input).hostname, 'console.invalid')
      assert.equal(init.headers.get('x-hzy-app-code'), 'console')
      assert.equal(init.headers.get('x-hzy-deployment'), 'test-console')
      assert.ok(!init.headers.get('x-forwarded-prefix'))
      assert.equal(init.headers.get('x-hzy-tenant'), 'test-tenant')
      return Response.json({ ok: true })
    } }
  }
  const response = await gateway.fetch(new Request('https://tenant.test/api/test', { headers: {
    'x-hzy-app-code': 'people', 'x-hzy-deployment': 'spoof', 'x-forwarded-prefix': '/people'
  } }), env)
  assert.equal(response.status, 200)
  assert.equal(called, 1)
})

test('Assets pages, callbacks and API use the configured Binding with target context', async () => {
  for (const path of ['/assets/', '/assets/api/auth/oidc-callback', '/assets/api/products']) {
    let called = 0
    const env = {
      HZY_ASSETS_ORIGIN: 'https://assets.invalid', HZY_CLOUDFLARE_INTERNAL_TOKEN: 'test-secret',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'tenant.test': {
        tenantCode: 'test-tenant', deploymentCode: 'test-console', environment: 'test',
        apps: { assets: { deploymentCode: 'test-assets' } }
      } } }),
      HZY_ASSETS_SERVICE: { async fetch(input, init) {
        called++
        assert.equal(new URL(input).hostname, 'assets.invalid')
        assert.equal(init.headers.get('x-hzy-app-code'), 'assets')
        assert.equal(init.headers.get('x-hzy-deployment'), 'test-assets')
        assert.equal(init.headers.get('x-forwarded-prefix'), '/assets')
        assert.equal(init.headers.get('x-hzy-tenant'), 'test-tenant')
        return Response.json({ ok: true })
      } }
    }
    const response = await gateway.fetch(new Request('https://tenant.test' + path, { headers: {
      'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'spoof', 'x-forwarded-prefix': '/aims'
    } }), env)
    assert.equal(response.status, 200)
    assert.equal(called, 1)
  }
})
