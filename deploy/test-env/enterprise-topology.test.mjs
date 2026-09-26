import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { enterprisePilot as p, resolveEnterprisePilotPath as route, validateEnterprisePilotBinding as valid } from './enterprise-topology.mjs'
import { enterpriseHostEntries, enterpriseHostRoutes } from './enterprise-host-routes.mjs'
import { businessModules } from '../../enterprise/composition/registry.mjs'
test('Console root/OAuth/callback remain separate from single Host auth and assets', () => {
  for (const path of ['/', '/api/auth/oidc-callback', '/oauth/token', '/_nuxt/console.js', '/finance/']) assert.equal(route(path), null)
  assert.deepEqual(route(new URL(p.callback).pathname), { path: '/api/auth/oidc-callback', kind: 'auth' })
  assert.deepEqual(route('/enterprise/_nuxt/host.js'), { path: '/enterprise/_nuxt/host.js', kind: 'asset' })
  assert.deepEqual(route('/enterprise/logo.svg'), { path: '/logo.svg', kind: 'asset' })
  assert.equal(route('/logo.svg'), null)
  for (const path of ['/aims/products', '/assets/products', '/codocs/mydocs', '/aims/api/v1/product-requests']) assert.equal(route(path).path, path)
  assert.deepEqual(route('/enterprise/api/navigation'), { path: '/enterprise/api/navigation', kind: 'api' })
  assert.deepEqual(route('/shell/aims', '?target=%2Faims%2Fproducts%3Ftab%3Dactive%23list'), { path: '/aims/products?tab=active#list', kind: 'redirect' })
  assert.deepEqual(route('/shell/assets'), { path: '/assets/products', kind: 'redirect' })
  assert.deepEqual(route('/shell/aims', '?target=%2Faims%2F%3Fhzy_embed%3D1%26search%3Dx%23list'), { path: '/aims/projects?search=x#list', kind: 'redirect' })
  assert.equal(route('/shell/aims', '?target=%2Faims%2Fapi%2Fv1%2Fproducts'), null)
  assert.equal(route('/shell/finance', '?target=%2Ffinance%2F'), null)
  assert.equal(route('/enterprise/unknown').kind, 'unavailable')
  assert.equal(route('/aims-evil/'), null)
})
test('generated Host route artifact matches the composition registry', () => {
  const gatewaySource = readFileSync(new URL('../cloudflare/tenant-gateway/src/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(gatewaySource, /enterprise\/composition|node:fs|fileURLToPath/)
  for (const module of businessModules) {
    const paths = []
    const collect = (pages, parent = module.prefix) => {
      for (const page of pages || []) {
        const full = page.path.startsWith('/') ? `${module.prefix}${page.path}` : `${parent}/${page.path}`.replace(/\/+/g, '/')
        paths.push(full.replace(/\/$/, '') || module.prefix)
        collect(page.children, full)
      }
    }
    collect(module.pages)
    assert.deepEqual(enterpriseHostRoutes[module.code], [...new Set(paths)])
    assert.equal(enterpriseHostEntries[module.code], `${module.prefix}${module.hostReadiness?.entryPath || '/'}`)
  }
})
test('Host mapping requires exact tenant/environment/deployment and real service binding', () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  assert.equal(valid(tenant, { fetch() {} }), true)
  for (const changed of [{ ...tenant, tenantCode: 'other' }, { ...tenant, environment: 'prod' }, { ...tenant, apps: { enterprise: { deploymentCode: 'C000001-test-aims' } } }]) assert.equal(valid(changed, { fetch() {} }), false)
  assert.equal(valid(tenant, null), false)
})
import gateway from '../cloudflare/tenant-gateway/src/index.js'
test('Gateway replaces forged Shell migration projection only for the exact active pilot', async () => {
  const calls = []
  const tenant = { tenantCode: p.tenantCode, deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  const env = {
    HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: p.tenantCode, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only',
    HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }),
    HZY_ENTERPRISE_SERVICE: { fetch: async () => new Response('host') },
    HZY_CONSOLE_SERVICE: { fetch: async (url, init) => { calls.push(init.headers); return new Response('console') } }
  }
  const request = () => new Request(p.origin + '/api/application-shell-migration', { headers: { 'x-hzy-enterprise-shell-pages': 'forged' } })
  assert.equal((await gateway.fetch(request(), env)).status, 200)
  const metadata = JSON.parse(calls.at(-1).get('x-hzy-enterprise-shell-pages'))
  assert.equal(metadata.consoleDeploymentCode, p.consoleDeployment)
  assert.equal(metadata.deploymentCode, p.deploymentCode)
  assert.deepEqual(metadata.pages, enterpriseHostRoutes)
  await gateway.fetch(request(), { ...env, HZY_ENTERPRISE_PILOT: 'false' })
  assert.equal(calls.at(-1).get('x-hzy-enterprise-shell-pages'), null)
  await gateway.fetch(request(), { ...env, HZY_ENTERPRISE_SERVICE: undefined })
  assert.equal(calls.at(-1).get('x-hzy-enterprise-shell-pages'), null)
})
test('real Gateway forwards logical APIs and callback with atomic Host identity and root prefix', async () => {
  const calls = []
  const tenant = { tenantCode: 'C000001', deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode, dataRuntime: { endpoint: p.runtimeEndpoint, runtimeCode: p.runtimeDeployment, staticToken: 'fixture-only', audience: 'data-runtime' } } } }
  const env = { HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: 'C000001', HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: { async fetch(url, init) { calls.push({ url, headers: init.headers }); return new Response('host') } } }
  for (const path of ['/aims/api/v1/products', '/assets/api/v1/products', '/codocs/mydocs', '/enterprise/api/auth/oidc-callback?code=fixture', '/enterprise/login', '/enterprise/_nuxt/file.js']) {
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
  assert.equal(new URL(calls[3].url).pathname, '/api/auth/oidc-callback')
  assert.equal(new URL(calls[5].url).pathname, '/enterprise/_nuxt/file.js')
  const bad = { ...env, HZY_ENTERPRISE_SERVICE: undefined }
  assert.equal((await gateway.fetch(new Request(p.origin + '/aims/products'), bad)).status, 503)
})
import { enterprisePilotConfig } from './enterprise-pilot-config.mjs'
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

test('legacy shell redirects only registered Host pages on GET', async () => {
  const tenant = { tenantCode: p.tenantCode, deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  const env = { HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: p.tenantCode, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: { async fetch() { throw Error('redirect must not call Host') } } }
  const target = await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts%3Ftab%3Dactive%23list`), env)
  assert.equal(target.status, 307)
  assert.equal(new URL(target.headers.get('location')).pathname, '/aims/products')
  assert.equal(new URL(target.headers.get('location')).search, '?tab=active')
  assert.equal(new URL(target.headers.get('location')).hash, '#list')
  assert.notEqual((await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts`, { method: 'POST' }), env)).status, 307)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts`), { ...env, HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': { ...tenant, environment: 'prod' } } }) })).status, 503)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts`), { ...env, HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': { ...tenant, apps: { enterprise: { deploymentCode: 'wrong' } } } } }) })).status, 503)
  assert.notEqual((await gateway.fetch(new Request(`${p.origin}/shell/finance?target=%2Ffinance%2F`), env)).status, 307)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts`), { ...env, HZY_ENTERPRISE_PILOT: 'false', HZY_ENTERPRISE_AUTH_PILOT: 'true' })).status !== 307, true)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/enterprise`), env)).status, 308)
})
