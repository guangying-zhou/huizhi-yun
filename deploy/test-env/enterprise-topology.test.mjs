import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enterprisePilot as p, resolveEnterprisePilotPath as route, validateEnterprisePilotBinding as valid } from './enterprise-topology.mjs'
test('Console root/OAuth/callback remain separate from single Host auth and assets', () => {
  for (const path of ['/', '/api/auth/oidc-callback', '/oauth/token', '/_nuxt/console.js', '/finance/']) assert.equal(route(path), null)
  assert.deepEqual(route(new URL(p.callback).pathname), { path: '/api/auth/oidc-callback', kind: 'auth' })
  assert.deepEqual(route('/enterprise/_nuxt/host.js'), { path: '/enterprise/_nuxt/host.js', kind: 'asset' })
  for (const path of ['/aims/products', '/assets/products', '/aims/api/v1/product-requests']) assert.equal(route(path).path, path)
  assert.equal(route('/enterprise/unknown').kind, 'unavailable')
  assert.equal(route('/aims-evil/'), null)
})
test('Host mapping requires exact tenant/environment/deployment and real service binding', () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  assert.equal(valid(tenant, { fetch() {} }), true)
  for (const changed of [{ ...tenant, tenantCode: 'other' }, { ...tenant, environment: 'prod' }, { ...tenant, apps: { enterprise: { deploymentCode: 'C000001-test-aims' } } }]) assert.equal(valid(changed, { fetch() {} }), false)
  assert.equal(valid(tenant, null), false)
})
import gateway from '../cloudflare/tenant-gateway/src/index.js'
test('real Gateway forwards logical APIs and callback with atomic Host identity and root prefix', async () => {
  const calls = []
  const tenant = { tenantCode: 'C000001', deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode, dataRuntime: { endpoint: p.runtimeEndpoint, runtimeCode: p.runtimeDeployment, staticToken: 'fixture-only', audience: 'data-runtime' } } } }
  const env = { HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: 'C000001', HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: { async fetch(url, init) { calls.push({ url, headers: init.headers }); return new Response('host') } } }
  for (const path of ['/aims/api/v1/products', '/assets/api/v1/products', '/enterprise/api/auth/oidc-callback?code=fixture', '/enterprise/login', '/enterprise/_nuxt/file.js']) {
    const result = await gateway.fetch(new Request(p.origin + path, { headers: { cookie: 'session=fixture', authorization: 'Bearer fixture', 'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'evil', 'x-forwarded-prefix': '/aims' } }), env)
    assert.equal(result.status, 200)
    const call = calls.at(-1)
    assert.equal(call.headers.get('x-hzy-app-code'), 'enterprise')
    assert.equal(call.headers.get('x-hzy-deployment'), p.deploymentCode)
    assert.equal(call.headers.get('x-forwarded-prefix'), '')
    if (path.includes('/api/') || path.includes('/auth/')) {
      assert.equal(call.headers.get('cookie'), 'session=fixture')
      assert.equal(call.headers.get('authorization'), 'Bearer fixture')
    } else {
      assert.equal(call.headers.get('cookie'), null)
      assert.equal(call.headers.get('authorization'), null)
    }
  }
  assert.equal(new URL(calls[2].url).pathname, '/api/auth/oidc-callback')
  assert.equal(new URL(calls[4].url).pathname, '/enterprise/_nuxt/file.js')
  const bad = { ...env, HZY_ENTERPRISE_SERVICE: undefined }
  assert.equal((await gateway.fetch(new Request(p.origin + '/aims/products'), bad)).status, 503)
})
import { enterprisePilotConfig } from './enterprise-pilot-config.mjs'
import { readFileSync } from 'node:fs'
test('build/auth/resource configuration uses same reserved prefix with legacy fallback', () => {
  const config=enterprisePilotConfig()
  assert.equal(config.host.vars.HZY_PLATFORM_DEPLOYMENT_CODE,p.deploymentCode)
  assert.deepEqual(config.gatewayPatch.services,[{binding:'HZY_ENTERPRISE_SERVICE',service:p.workerName}])
  const nuxt=readFileSync(new URL('../../enterprise/nuxt.config.ts',import.meta.url),'utf8')
  assert.ok(nuxt.includes("buildAssetsDir: '/enterprise/_nuxt/'"))
  assert.ok(nuxt.includes(p.callback))
  for(const file of ['../../foundation/app/composables/useConsoleOidcAuth.ts','../../foundation/app/composables/useAuthorization.ts']){
    const source=readFileSync(new URL(file,import.meta.url),'utf8')
    assert.ok(source.includes("authApiPrefix === '/enterprise'"))
    assert.ok(source.includes("=== 'enterprise'"))
  }
})

test('Enterprise production build omits source maps from the Worker artifact', () => {
  const config = readFileSync(new URL('../../enterprise/nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(config, /sourcemap:\s*\{\s*server:\s*false,\s*client:\s*false\s*\}/)
})

test('auth-only pilot verifies Host login without taking over business routes', async () => {
  const calls = []
  const tenant = { tenantCode: p.tenantCode, deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode }, aims: { deploymentCode: 'C000001-test-aims' }, assets: { deploymentCode: 'C000001-test-assets' } } }
  const binding = name => ({ async fetch() { calls.push(name); return new Response(name) } })
  const env = { HZY_ENTERPRISE_AUTH_PILOT: 'true', HZY_ALLOWED_TENANTS: p.tenantCode, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: binding('enterprise'), HZY_CONSOLE_SERVICE: binding('console'), HZY_AIMS_SERVICE: binding('aims'), HZY_ASSETS_SERVICE: binding('assets') }
  for (const [path, expected] of [['/enterprise/login','enterprise'], ['/enterprise/api/auth/session','enterprise'], ['/enterprise/_nuxt/app.js','enterprise'], ['/aims/products','aims'], ['/assets/products','assets'], ['/oauth/token','console'], ['/','console']]) {
    const response = await gateway.fetch(new Request(p.origin + path), env)
    assert.equal(response.status, 200)
    assert.equal(calls.at(-1), expected, path)
  }
  assert.equal((await gateway.fetch(new Request(p.origin + '/enterprise/login'), { ...env, HZY_ENTERPRISE_SERVICE: undefined })).status, 503)
})
