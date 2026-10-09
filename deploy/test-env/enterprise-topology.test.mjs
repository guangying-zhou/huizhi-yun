import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { enterprisePilot as p, resolveEnterprisePilotPath as route, validateEnterprisePilotBinding as valid } from './enterprise-topology.mjs'
import { enterpriseHostEntries, enterpriseHostRoutes } from './enterprise-host-routes.mjs'
import { renderEnterpriseHostRoutes } from './generate-enterprise-host-routes.mjs'
import { businessApiRoutes } from '../../enterprise/composition/business-api-routes.generated.mjs'
import { businessModules, hostNativePages } from '../../enterprise/composition/registry.mjs'
test('Console root/OAuth/callback remain separate from single Host auth and assets', () => {
  for (const path of ['/api/auth/oidc-callback', '/oauth/token', '/_nuxt/console.js']) assert.equal(route(path), null)
  // The Host workbench is the site entry: root and slash form are aliases of /enterprise.
  assert.deepEqual(route('/enterprise'), { path: '/enterprise', kind: 'page' })
  for (const path of ['/', '/enterprise/']) assert.deepEqual(route(path), { path: '/enterprise', kind: 'redirect' })
  assert.deepEqual(route(new URL(p.callback).pathname), { path: '/api/auth/oidc-callback', kind: 'auth' })
  assert.deepEqual(route('/enterprise/_nuxt/host.js'), { path: '/enterprise/_nuxt/host.js', kind: 'asset' })
  assert.deepEqual(route('/enterprise/logo.svg'), { path: '/logo.svg', kind: 'asset' })
  assert.equal(route('/logo.svg'), null)
  assert.deepEqual(route('/enterprise/favicon.ico'), { path: '/favicon.ico', kind: 'asset' })
  assert.deepEqual(route('/enterprise/favicon.png'), { path: '/favicon.png', kind: 'asset' })
  assert.equal(route('/favicon.ico'), null)
  assert.deepEqual(route('/enterprise/notifications'), { path: '/enterprise/notifications', kind: 'page' })
  assert.deepEqual(route('/enterprise/notifications/ntf_01-A'), { path: '/enterprise/notifications/ntf_01-A', kind: 'page' })
  // Unregistered Host page paths render the Host's own 404 page; writes, APIs and unsafe paths stay unavailable.
  assert.deepEqual(route('/enterprise/notifications/a/b'), { path: '/enterprise/notifications/a/b', kind: 'page' })
  assert.equal(route('/enterprise/notifications/a/b', '', 'POST').kind, 'unavailable')
  for (const path of ['/enterprise/a/../b', '/enterprise/x%2fy', '/enterprise/api/unknown']) assert.equal(route(path).kind, 'unavailable', path)
  assert.deepEqual(route('/enterprise/illustrations/404.svg'), { path: '/illustrations/404.svg', kind: 'asset' })
  assert.equal(route('/enterprise/illustrations/404.svg', '', 'POST').kind, 'unavailable')
  // Console administration pages are no longer Host routes (ADR-018a D8).
  for (const path of ['/enterprise/org-profile', '/enterprise/directory/users', '/enterprise/work-calendar', '/enterprise/admin/regions', '/enterprise/data-runtime']) assert.deepEqual(route(path), { path, kind: 'page' }, path)
  for (const path of ['/enterprise/api/org-profile', '/enterprise/api/directory/users', '/enterprise/api/work-calendars', '/enterprise/api/runtime-status/data']) assert.equal(route(path).kind, 'unavailable', path)
  assert.deepEqual(route('/enterprise/todos'), { path: '/enterprise/todos', kind: 'page' })
  assert.deepEqual(route('/enterprise/api/notifications/todos'), { path: '/enterprise/api/notifications/todos', kind: 'api' })
  assert.deepEqual(route('/enterprise/api/notifications/other').kind, 'unavailable')
  for (const path of ['/aims/products', '/assets/products', '/codocs/mydocs', '/aims/api/v1/product-requests']) assert.equal(route(path).path, path)
  assert.deepEqual(route('/enterprise/api/navigation'), { path: '/enterprise/api/navigation', kind: 'api' })
  // Per-module permission snapshot is a Host API: no auth-prefix rewrite, GET only.
  assert.deepEqual(route('/enterprise/api/auth/permissions', '?app=aims', 'GET'), { path: '/enterprise/api/auth/permissions', kind: 'api' })
  assert.equal(route('/enterprise/api/auth/permissions', '', 'POST').kind, 'unavailable')
  assert.equal(route('/enterprise/api/auth/permissions/extra').path, '/api/auth/permissions/extra')
  assert.deepEqual(route('/shell/aims', '?target=%2Faims%2Fproducts%3Ftab%3Dactive%23list'), { path: '/aims/products?tab=active#list', kind: 'redirect' })
  assert.deepEqual(route('/shell/assets'), { path: '/assets/products', kind: 'redirect' })
  assert.deepEqual(route('/shell/aims', '?target=%2Faims%2F%3Fhzy_embed%3D1%26search%3Dx%23list'), { path: '/aims/projects?search=x#list', kind: 'redirect' })
  assert.equal(route('/shell/aims', '?target=%2Faims%2Fapi%2Fv1%2Fproducts'), null)
  assert.equal(route('/shell/altoc'), null)
  assert.deepEqual(route('/shell/finance', '?target=%2Ffinance%2F'), { path: '/finance/bank-accounts', kind: 'redirect' })
  for (const path of ['/enterprise/directory/departments-edit/extra', '/enterprise/unknown']) assert.deepEqual(route(path), { path, kind: 'page' })
  assert.equal(route('/enterprise/unknown', '', 'PUT').kind, 'unavailable')
  assert.equal(route('/aims-evil/'), null)
})
test('generated Host route artifact matches the composition registry', () => {
  assert.equal(readFileSync(new URL('./enterprise-host-routes.mjs', import.meta.url), 'utf8'), renderEnterpriseHostRoutes())
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
  const oidc=readFileSync(new URL('../../foundation/app/composables/useConsoleOidcAuth.ts',import.meta.url),'utf8')
  assert.ok(oidc.includes("authApiPrefix === '/enterprise'"))
  assert.ok(oidc.includes("=== 'enterprise'"))
  // The Host permission snapshot is a Host API (always under /enterprise/api),
  // not an auth-prefixed Foundation route; see resolveAuthorizationSnapshotSource.
  const snapshot=readFileSync(new URL('../../foundation/shared/utils/authorizationSnapshotSource.ts',import.meta.url),'utf8')
  assert.ok(snapshot.includes("ENTERPRISE_AUTHORIZATION_PERMISSIONS_PATH = '/enterprise/api/auth/permissions'"))
  assert.ok(snapshot.includes("=== 'enterprise'"))
  assert.deepEqual(route('/enterprise/api/auth/permissions','?app=aims','GET'),{path:'/enterprise/api/auth/permissions',kind:'api'})
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
  assert.equal((await gateway.fetch(new Request(`${p.origin}/shell/finance?target=%2Ffinance%2F`), env)).status, 307)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts`), { ...env, HZY_ENTERPRISE_PILOT: 'false', HZY_ENTERPRISE_AUTH_PILOT: 'true' })).status !== 307, true)
  for (const path of ['/', '/enterprise/', '/?from=bookmark']) {
    for (const method of ['GET', 'HEAD']) {
      const entry = await gateway.fetch(new Request(`${p.origin}${path}`, { method }), env)
      assert.equal(entry.status, 302, path)
      assert.equal(entry.headers.get('cache-control'), 'no-store')
      const location = new URL(entry.headers.get('location'))
      assert.equal(`${location.origin}${location.pathname}`, `${p.origin}/enterprise`)
      assert.equal(location.search, path.includes('?') ? '?from=bookmark' : '')
    }
    assert.equal((await gateway.fetch(new Request(`${p.origin}${path}`, { method: 'POST' }), env)).status, 405)
  }
  const hostCalls = []
  const workbench = await gateway.fetch(new Request(`${p.origin}/enterprise`), { ...env, HZY_ENTERPRISE_SERVICE: { async fetch(url) { hostCalls.push(new URL(url).pathname); return new Response('workbench') } } })
  assert.equal(workbench.status, 200)
  assert.deepEqual(hostCalls, ['/enterprise'])
})

test('personal profile is an exact Host page, without a new user selector or BFF', () => {
  assert.deepEqual(route('/enterprise/profile'), { path: '/enterprise/profile', kind: 'page' })
  // Sub-paths only reach the Host 404 page (no session forwarded); no profile BFF exists.
  for (const path of ['/enterprise/profile/U1', '/enterprise/profile/password']) assert.equal(route(path).kind, 'page')
  assert.equal(route('/enterprise/api/profile').kind, 'unavailable')
})


test('APF exposes registered pages and exact BFF methods only', () => {
  for (const app of ['finance', 'altoc']) {
    for (const pattern of enterpriseHostRoutes[app]) {
      const path = pattern.replace(/:[A-Za-z]+/g, app === 'altoc' ? '7' : 'ACCOUNT-7')
      for (const method of ['GET', 'HEAD']) assert.deepEqual(route(path, '', method), { path, kind: 'page' })
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(route(path, '', method).kind, 'unavailable')
    }
    for (const [method, pattern] of businessApiRoutes.filter(([, path]) => path.startsWith(`/${app}/api/v1/`))) {
      const path = pattern.replace(/:[A-Za-z]+/g, app === 'altoc' ? '7' : 'ACCOUNT-7')
      assert.deepEqual(route(path, '', method), { path, kind: 'api' }, `${method} ${path}`)
      for (const wrong of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const registered = businessApiRoutes.some(([allowed, registeredPath]) => allowed === wrong && registeredPath.split('/').length === path.split('/').length && registeredPath.split('/').every((segment, index) => segment.startsWith(':') || segment === path.split('/')[index]))
        if (!registered) assert.equal(route(path, '', wrong).kind, 'unavailable', `${wrong} ${path}`)
      }
    }
  }
  for (const path of ['/finance/', '/finance/unknown', '/finance/api/v1/bank-accounts/7/extra', '/finance/api/v1/service/accounts', '/altoc/settings', '/altoc/api/v1/service/contracts', '/altoc/api/v1/customers/0', '/altoc/api/v1/customers/9007199254740993', '/altoc/api/v1/customers/7/extra', '/finance/bank-accounts/a%2fb', '/finance//bank-accounts']) {
    assert.equal(route(path).kind, 'unavailable', path)
  }
  assert.deepEqual(enterpriseHostRoutes.altoc, hostNativePages.filter(page => page.module === 'altoc').map(page => page.path))
})

test('P5a1 reuses both existing Host time-entry read paths with pagination query intact', () => {
  for (const path of ['/aims/api/v1/users/person-a/time-entries', '/aims/api/v1/projects/12/time-entries']) {
    assert.deepEqual(route(path, '?page=2&pageSize=100&weekStart=2026-09-21&weekEnd=2026-09-27', 'GET'), { path, kind: 'api' })
  }
})

test('P5a2 exact existing review read path reaches Host with ISO period and bounded page', () => {
  const path = '/aims/api/v1/projects/12/time-entry-reviews'
  assert.deepEqual(route(path, '?periodKey=2026-W39&page=2&pageSize=100', 'GET'), { path, kind: 'api' })
})

test('G-12 Host shared user APIs reach the Host with its session; root /api stays Console', async () => {
  const calls = []
  const tenant = { tenantCode: p.tenantCode, deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  const env = { HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: p.tenantCode, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: { async fetch(url, init) { calls.push({ url, headers: init.headers }); return new Response('host') } } }
  const headers = { cookie: 'hzy_enterprise_access_token=fixture', 'x-hzy-app-code': 'console', 'x-hzy-deployment': 'evil', 'x-forwarded-prefix': '/console' }
  for (const [method, path] of [
    ['GET', '/enterprise/api/foundation/notifications'], ['GET', '/enterprise/api/foundation/notifications/ntf_1/detail'],
    ['POST', '/enterprise/api/foundation/notifications/ntf_1/read'], ['GET', '/enterprise/api/foundation/user/applications'],
    ['GET', '/enterprise/api/foundation/directory/me'], ['POST', '/enterprise/api/foundation/directory/users/batch'],
    ['GET', '/enterprise/api/foundation/workflow-proxy/tasks/pending'], ['POST', '/enterprise/api/foundation/workflow-proxy/tasks/12/approve']
  ]) {
    const response = await gateway.fetch(new Request(p.origin + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) }), env)
    assert.equal(response.status, 200, `${method} ${path}`)
    const call = calls.at(-1)
    assert.equal(new URL(call.url).pathname, path)
    assert.equal(call.headers.get('cookie'), headers.cookie)
    assert.equal(call.headers.get('x-hzy-app-code'), 'enterprise')
    assert.equal(call.headers.get('x-hzy-deployment'), p.deploymentCode)
    assert.equal(call.headers.get('x-forwarded-prefix'), '')
  }
  const icon = await gateway.fetch(new Request(`${p.origin}/enterprise/_nuxt_icon/lucide.json?icons=menu`, { headers }), env)
  assert.equal(icon.status, 200)
  assert.equal(new URL(calls.at(-1).url).pathname, '/enterprise/_nuxt_icon/lucide.json')
  assert.equal(calls.at(-1).headers.get('cookie'), null)
  const before = calls.length
  for (const [method, path] of [['DELETE', '/enterprise/api/foundation/notifications'], ['GET', '/enterprise/api/foundation/directory/user-departments'], ['POST', '/enterprise/_nuxt_icon/lucide.json']]) {
    assert.equal((await gateway.fetch(new Request(p.origin + path, { method, headers }), env)).status, 503, `${method} ${path}`)
  }
  assert.equal(calls.length, before)
  for (const path of ['/api/notifications', '/api/directory/users', '/api/user/applications', '/api/workflow-proxy/tasks/pending', '/api/_nuxt_icon/lucide.json']) assert.equal(route(path, '', 'GET'), null)
})


test('B2 customer contacts read has exact Gateway registration without widening writes', () => {
  assert.deepEqual(route('/altoc/api/v1/customers/1/contacts', '?page=2&pageSize=20', 'GET'), { path: '/altoc/api/v1/customers/1/contacts', kind: 'api' })
  assert.equal(route('/altoc/api/v1/customers/1/contacts/unknown', '', 'GET').kind, 'unavailable')
})


test('announcements register exact Host pages and API verbs', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  for (const path of ['/enterprise/help', '/enterprise/announcements', `/enterprise/announcements/${id}`]) {
    assert.equal(route(path).kind, 'page')
    assert.equal(route(path, '', 'POST').kind, 'unavailable')
  }
  assert.equal(route('/enterprise/api/announcements', '', 'GET').kind, 'api')
  assert.equal(route(`/enterprise/api/announcements/${id}/read`, '', 'POST').kind, 'api')
  assert.equal(route(`/enterprise/api/announcements/${id}/read`, '', 'GET').kind, 'unavailable')
  assert.equal(route('/enterprise/api/announcements/manage', '', 'POST').kind, 'api')
  assert.notEqual(route('/enterprise/api/announcements/execute-anything', '', 'POST')?.kind, 'api')
})
