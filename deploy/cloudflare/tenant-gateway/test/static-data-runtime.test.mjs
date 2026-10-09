import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { normalizeTenantRecord, schedulerRequestHeaders, withStaticDataRuntimeEndpoint } from '../src/index.js'

const PIN = 'https://aidcp-runtime.wiztek.cn'
const env = {
  HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'gateway-secret',
  HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_ENDPOINT: PIN,
  HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_CODE: 'c000001-prod-tenant-runtime'
}
const registry = (over = {}) => ({
  tenantCode: 'C000001', environment: 'prod', deploymentCode: 'C000001-console',
  dataRuntime: { audience: 'data-runtime', runtimeCode: 'c000001-prod-tenant-runtime', status: 'ready', ...(over.dataRuntime || {}) },
  apps: { console: { deploymentCode: 'C000001-console', dataRuntime: { endpoint: PIN } }, aims: { deploymentCode: 'C000001-aims', enterpriseScheduler: { storage: 'unified', generation: '1' } }, ...(over.apps || {}) }
})
const resolve = (record, e = env) => withStaticDataRuntimeEndpoint(normalizeTenantRecord(record, e, true), e)

test('without the self-hosted variables nothing changes (Cloudflare)', () => {
  const tenant = normalizeTenantRecord(registry(), {}, true)
  assert.equal(withStaticDataRuntimeEndpoint(tenant, {}), tenant)
  assert.equal(withStaticDataRuntimeEndpoint(tenant, { HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_CODE: 'c000001-prod-tenant-runtime' }), tenant)
})

test('a missing endpoint is filled when the pinned Runtime is ready and the code matches', () => {
  const tenant = resolve(registry())
  assert.equal(tenant.allowed, true)
  assert.equal(tenant.dataRuntime.endpoint, PIN)
  assert.equal(tenant.dataRuntime.runtimeCode, 'c000001-prod-tenant-runtime')
})

test('not ready, wrong code, or no pinned code keep the missing endpoint (fail closed)', () => {
  assert.equal(resolve(registry({ dataRuntime: { status: 'degraded' } })).dataRuntime.endpoint, '')
  assert.equal(resolve(registry({ dataRuntime: { status: undefined } })).dataRuntime.endpoint, '')
  assert.equal(resolve(registry({ dataRuntime: { runtimeCode: 'c000001-test-tenant-runtime' } })).dataRuntime.endpoint, '')
  assert.equal(resolve(registry(), { ...env, HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_CODE: '' }).dataRuntime.endpoint, '')
})

test('a registry endpoint that differs from the pin refuses the tenant, at top level and per app', () => {
  assert.equal(resolve(registry({ dataRuntime: { endpoint: 'https://other-runtime.example.com' } })).allowed, false)
  assert.equal(resolve(registry({ apps: { workflow: { deploymentCode: 'C000001-workflow', dataRuntime: { endpoint: 'https://other-runtime.example.com' } } } })).allowed, false)
  const same = resolve(registry({ dataRuntime: { endpoint: PIN } }))
  assert.equal(same.allowed, true)
  assert.equal(same.dataRuntime.endpoint, PIN)
})

test('scheduler headers and signature use the same pinned endpoint for aims', async () => {
  const tenant = resolve(registry())
  const headers = await schedulerRequestHeaders(env, tenant, 'aidcp.wiztek.cn', 'aims', 'req-1', '1790000000000', 'bootstrap')
  assert.equal(headers.get('x-hzy-data-runtime-url'), PIN)
  const canonical = ['POST', '/api/internal/integration-operations/drain', 'req-1', 'C000001', 'C000001-aims', 'aims', 'prod', PIN, 'aidcp.wiztek.cn',
    'enterprise-scheduler-v1', 'unified', '1', '1790000000000']
  assert.ok(headers.get('x-hzy-scheduler-signature'))
  assert.equal(headers.get('x-hzy-scheduler-signature'), createHmac('sha256', 'gateway-secret').update(canonical.join('\n')).digest('hex'))
})

test('self-hosted service route catalog carries Console; Cloudflare catalog is unchanged', async () => {
  const selfHosted = { ...env, HZY_TENANT_GATEWAY_SERVICE_ROUTES_INCLUDE_CONSOLE: 'true', HZY_CONSOLE_ORIGIN: 'http://127.0.0.1:31001', HZY_CONSOLE_BASE_PATH: '/console', HZY_AIMS_ORIGIN: 'http://127.0.0.1:31004' }
  const tenant = resolve(registry())
  const routes = JSON.parse((await schedulerRequestHeaders(selfHosted, tenant, 'aidcp.wiztek.cn', 'aims', 'req-2', '1790000000000', 'bootstrap')).get('x-hzy-service-routes'))
  assert.deepEqual(routes.console, { origin: 'http://127.0.0.1:31001', deploymentCode: 'C000001-console', basePath: '/console/' })
  assert.equal(routes.aims.deploymentCode, 'C000001-aims')
  const cloudflare = { HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'gateway-secret', HZY_CONSOLE_ORIGIN: 'https://console.huizhi.yun', HZY_AIMS_ORIGIN: 'https://aims.example.test' }
  const cfRoutes = JSON.parse((await schedulerRequestHeaders(cloudflare, normalizeTenantRecord(registry(), cloudflare, true), 'aidcp.wiztek.cn', 'aims', 'req-3', '1790000000000', 'bootstrap')).get('x-hzy-service-routes'))
  assert.equal(cfRoutes.console, undefined)
  // the static Runtime pin alone does not add Console: the switch is separate
  const pinOnly = { ...selfHosted, HZY_TENANT_GATEWAY_SERVICE_ROUTES_INCLUDE_CONSOLE: '' }
  assert.equal(JSON.parse((await schedulerRequestHeaders(pinOnly, tenant, 'aidcp.wiztek.cn', 'aims', 'req-5', '1790000000000', 'bootstrap')).get('x-hzy-service-routes')).console, undefined)
  // no Console app in the registry record -> no entry even when self-hosted
  const noConsole = resolve({ ...registry(), apps: { aims: { deploymentCode: 'C000001-aims' } } })
  const r2 = JSON.parse((await schedulerRequestHeaders(selfHosted, noConsole, 'aidcp.wiztek.cn', 'aims', 'req-4', '1790000000000', 'bootstrap')).get('x-hzy-service-routes'))
  assert.equal(r2.console, undefined)
  // apps.console without its own deployment code must not fall back to the tenant default deployment
  const noCode = resolve({ ...registry(), apps: { console: { basePath: '/console/' }, aims: { deploymentCode: 'C000001-aims' } } })
  assert.equal(noCode.deploymentCode, 'C000001-console')
  const r3 = JSON.parse((await schedulerRequestHeaders(selfHosted, noCode, 'aidcp.wiztek.cn', 'aims', 'req-6', '1790000000000', 'bootstrap')).get('x-hzy-service-routes'))
  assert.equal(r3.console, undefined)
})

test('a client-supplied service route catalog never reaches the app; the Gateway catalog carries Console', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  const workerEnv = {
    ...env, HZY_CONSOLE_ORIGIN: 'http://127.0.0.1:31001', HZY_CONSOLE_BASE_PATH: '/console', HZY_TENANT_GATEWAY_SERVICE_ROUTES_INCLUDE_CONSOLE: 'true',
    HZY_AIMS_ORIGIN: 'http://127.0.0.1:31004',
    HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'aidcp.wiztek.cn': registry() } }),
    HZY_AIMS_SERVICE: { async fetch(input, init) { calls.push(init); return Response.json({ ok: true }) } }
  }
  const { default: gateway } = await import('../src/index.js')
  try {
    const response = await gateway.fetch(new Request('https://aidcp.wiztek.cn/aims/api/ping', { headers: {
      'x-hzy-service-routes': '{"console":{"origin":"https://attacker.example.test","deploymentCode":"evil","basePath":"/console/"}}'
    } }), workerEnv)
    assert.equal(response.status, 200)
  } finally { globalThis.fetch = originalFetch }
  const sent = calls[0].headers.get('x-hzy-service-routes')
  assert.ok(sent, 'catalog is set by the Gateway')
  assert.doesNotMatch(sent, /attacker|evil/)
  assert.deepEqual(JSON.parse(sent).console, { origin: 'http://127.0.0.1:31001', deploymentCode: 'C000001-console', basePath: '/console/' })
})
