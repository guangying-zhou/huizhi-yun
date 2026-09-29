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
  assert.deepEqual(route('/enterprise/favicon.ico'), { path: '/favicon.ico', kind: 'asset' })
  assert.deepEqual(route('/enterprise/favicon.png'), { path: '/favicon.png', kind: 'asset' })
  assert.equal(route('/favicon.ico'), null)
  assert.deepEqual(route('/enterprise/notifications'), { path: '/enterprise/notifications', kind: 'page' })
  assert.deepEqual(route('/enterprise/notifications/ntf_01-A'), { path: '/enterprise/notifications/ntf_01-A', kind: 'page' })
  assert.deepEqual(route('/enterprise/notifications/a/b').kind, 'unavailable')
  assert.deepEqual(route('/enterprise/org-profile'), { path: '/enterprise/org-profile', kind: 'page' })
  assert.deepEqual(route('/enterprise/api/org-profile'), { path: '/enterprise/api/org-profile', kind: 'api' })
  assert.equal(route('/enterprise/api/org-profile/extra').kind, 'unavailable')
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
  assert.equal(route('/shell/finance', '?target=%2Ffinance%2F'), null)
  for (const path of ['/enterprise/directory/departments-new', '/enterprise/directory/departments-edit', '/enterprise/directory/projects-new', '/enterprise/directory/projects-edit', '/enterprise/directory/projects-members']) assert.deepEqual(route(path), { path, kind: 'page' })
  assert.equal(route('/enterprise/directory/departments-edit/extra').kind, 'unavailable')
  assert.equal(route('/enterprise/directory/projects-edit/extra').kind, 'unavailable')
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
  assert.notEqual((await gateway.fetch(new Request(`${p.origin}/shell/finance?target=%2Ffinance%2F`), env)).status, 307)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/shell/aims?target=%2Faims%2Fproducts`), { ...env, HZY_ENTERPRISE_PILOT: 'false', HZY_ENTERPRISE_AUTH_PILOT: 'true' })).status !== 307, true)
  assert.equal((await gateway.fetch(new Request(`${p.origin}/enterprise`), env)).status, 308)
})

test('users Host page and GET paths have exact pilot registrations', () => {
  assert.deepEqual(route('/enterprise/directory/users'), { path: '/enterprise/directory/users', kind: 'page' })
  for (const path of ['/enterprise/api/directory/users', '/enterprise/api/directory/users/U1']) assert.deepEqual(route(path), { path, kind: 'api' })
  for (const path of ['/enterprise/api/directory/users/U1/password', '/enterprise/api/directory/users/..', '/enterprise/directory/users/new']) assert.equal(route(path).kind, 'unavailable')
})

test('departments Host registrations are exact', () => {
  assert.deepEqual(route('/enterprise/directory/departments'), { path: '/enterprise/directory/departments', kind: 'page' })
  for (const path of ['/enterprise/api/directory/departments', '/enterprise/api/directory/departments/D1']) assert.deepEqual(route(path), { path, kind: 'api' })
  for (const path of ['/enterprise/directory/departments/new', '/enterprise/api/directory/departments/D1/members']) assert.equal(route(path).kind, 'unavailable')
})

test('directory project Host routes are exact', () => {
  assert.deepEqual(route('/enterprise/directory/projects'), { path: '/enterprise/directory/projects', kind: 'page' })
  for (const path of ['/enterprise/api/directory/projects', '/enterprise/api/directory/projects/P1', '/enterprise/api/directory/projects/members']) assert.deepEqual(route(path), { path, kind: 'api' })
  for (const path of ['/enterprise/directory/projects/new', '/enterprise/api/directory/projects/P1/members', '/enterprise/api/directory/projects/..']) assert.equal(route(path).kind, 'unavailable')
})

test('committee Host routes include exact item and member URLs', () => {
  assert.deepEqual(route('/enterprise/directory/committees'), { path: '/enterprise/directory/committees', kind: 'page' })
  for (const path of ['/enterprise/api/directory/committees', '/enterprise/api/directory/committees/C1', '/enterprise/api/directory/committees/C1/members', '/enterprise/api/directory/committees/C1/members/U1', '/enterprise/api/directory/committees/C_1.2-3/members/U_1.2-3']) assert.deepEqual(route(path), { path, kind: 'api' })
  for (const path of ['/enterprise/directory/committees/new', '/enterprise/api/directory/committees/.', '/enterprise/api/directory/committees/..', '/enterprise/api/directory/committees/../members', '/enterprise/api/directory/committees/C1/members/.', '/enterprise/api/directory/committees/C1/members/..', '/enterprise/api/directory/committees/C1/other', '/enterprise/api/directory/committees/C1/members/U1/extra', '/enterprise/api/directory/committees-other/C1']) assert.equal(route(path).kind, 'unavailable')
})

test('personal profile is an exact Host page, without a new user selector or BFF', () => {
  assert.deepEqual(route('/enterprise/profile'), { path: '/enterprise/profile', kind: 'page' })
  for (const path of ['/enterprise/profile/U1', '/enterprise/profile/password', '/enterprise/api/profile']) assert.equal(route(path).kind, 'unavailable')
})


test('calendar Host registrations exclude import and per-day editing', () => {
  assert.deepEqual(route('/enterprise/work-calendar'), { path: '/enterprise/work-calendar', kind: 'page' })
  for (const path of ['/enterprise/api/work-calendars', '/enterprise/api/work-calendars/CN/months', '/enterprise/api/work-calendars/CN/days']) assert.deepEqual(route(path), { path, kind: 'api' })
  for (const path of ['/enterprise/api/work-calendars/CN/import-year', '/enterprise/api/work-calendars/CN/days/2026-09-01', '/enterprise/work-calendar/import']) assert.equal(route(path).kind, 'unavailable')
})


test('sync pages and BFF paths are exact without source or trigger routes', () => {
  for (const path of ['/enterprise/directory/sync', '/enterprise/directory/sync/J1']) assert.deepEqual(route(path), { path, kind: 'page' })
  for (const path of ['/enterprise/api/directory/sync-jobs', '/enterprise/api/directory/sync-jobs/J1', '/enterprise/api/directory/sync-jobs/J1/events']) assert.deepEqual(route(path), { path, kind: 'api' })
  for (const path of ['/enterprise/directory/sources', '/enterprise/api/directory/sync-jobs/J1/retry', '/enterprise/api/directory/sync-jobs/../events', '/enterprise/api/directory/sync-jobs/J1/events/1']) assert.equal(route(path).kind, 'unavailable')
})

test('C1 exact GET organization paths reach Host with atomic identity', async () => {
  const calls = []
  const tenant = { tenantCode: p.tenantCode, deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  const env = { HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: p.tenantCode, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: { async fetch(url, init) { calls.push({ url, headers: init.headers }); return new Response('host') } } }
  for (const path of ['/enterprise/api/organization/business-domains', '/enterprise/api/organization/regions', '/enterprise/api/organization/regions/R1/divisions']) {
    const response = await gateway.fetch(new Request(p.origin + path, { method: 'GET' }), env)
    assert.equal(response.status, 200)
    assert.equal(new URL(calls.at(-1).url).pathname, path)
    assert.equal(calls.at(-1).headers.get('x-hzy-app-code'), 'enterprise')
    assert.equal(calls.at(-1).headers.get('x-hzy-deployment'), p.deploymentCode)
    assert.equal(calls.at(-1).headers.get('x-forwarded-prefix'), '')
  }
})

test('C2 exact GET safe status paths reach Host with atomic identity', async () => {
  const calls = []
  const tenant = { tenantCode: p.tenantCode, deploymentCode: p.consoleDeployment, environment: 'test', apps: { enterprise: { deploymentCode: p.deploymentCode } } }
  const env = { HZY_ENTERPRISE_PILOT: 'true', HZY_ALLOWED_TENANTS: p.tenantCode, HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only', HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': tenant } }), HZY_ENTERPRISE_SERVICE: { async fetch(url, init) { calls.push({ url, headers: init.headers }); return new Response('host') } } }
  for (const path of ['/enterprise/api/runtime-status/data', '/enterprise/api/runtime-status/applications']) {
    const response = await gateway.fetch(new Request(p.origin + path, { method: 'GET' }), env)
    assert.equal(response.status, 200)
    assert.equal(new URL(calls.at(-1).url).pathname, path)
    assert.equal(calls.at(-1).headers.get('x-hzy-app-code'), 'enterprise')
    assert.equal(calls.at(-1).headers.get('x-hzy-deployment'), p.deploymentCode)
    assert.equal(calls.at(-1).headers.get('x-forwarded-prefix'), '')
  }
})

test('Altoc G1 registers each GET list/detail and six native pages without enabling its prefix or writes', () => {
 for (const folder of ['customers', 'contracts', 'payments', 'leads', 'opportunities', 'quotes']) {
  for (const path of [`/altoc/${folder}`, `/altoc/${folder}/7`]) {
   assert.deepEqual(route(path, '', 'GET'), { path, kind: 'page' })
   assert.deepEqual(route(path, '', 'HEAD'), { path, kind: 'page' })
  }
  for (const path of [`/altoc/api/v1/${folder}`, `/altoc/api/v1/${folder}/7`]) {
   assert.deepEqual(route(path, '', 'GET'), { path, kind: 'api' })
   for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.equal(route(path, '', method).kind, 'unavailable')
  }
  for (const suffix of ['/0', '/new', '/9007199254740993', '/7/edit', '/7/invoices', '/7/extra']) assert.equal(route(`/altoc/api/v1/${folder}${suffix}`), null)
 }
 for (const path of ['/altoc', '/altoc/', '/altoc/api/v1/service/contracts', '/altoc/settings', '/altoc/contracts/new']) assert.equal(route(path), null)
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
