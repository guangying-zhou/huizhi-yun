import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudflareConfig, validateCloudflareTestConfig } from '../cloudflare-config.mjs'
import { drainWorkerConfig, coordinatorConfig } from './build-config.mjs'
import { drainControlResponse } from './control-proxy.mjs'

test('source wrapper requires explicit configuration; coordinator is internal only', () => {
  for (const app of ['aims', 'assets']) {
    const original = cloudflareConfig(app)
    assert.ok(!original.services.some(value => value.binding === 'HZY_DRAIN_COORDINATOR'))
    const config = validateCloudflareTestConfig(drainWorkerConfig(original))
    assert.equal(config.main, './drain-entry.mjs')
    assert.equal(config.workers_dev, false)
  }
  assert.throws(() => drainWorkerConfig(cloudflareConfig('console')))
  const coordinator = coordinatorConfig()
  assert.equal(coordinator.workers_dev, false)
  assert.equal(coordinator.routes, undefined)
  assert.deepEqual(coordinator.migrations[0].new_sqlite_classes, ['TestDrainCoordinator'])
})
test('control proxy rejects business credential, wrong host, tenant and disabled configuration', async () => {
  let calls = 0
  const env = { HZY_TEST_DRAIN_CONTROL_ENABLED: 'true', HZY_DRAIN_CONTROL_TOKEN: 'control', HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'business', HZY_DRAIN_COORDINATOR: { async fetch() { calls++; return Response.json({ ok: true }) } } }
  const request = (token = 'control', host = 'hzy-test.huizhi.yun', tenant = 'C000001') => new Request(`https://${host}/__test/drain/snapshot`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ tenant, environment: 'test' }) })
  assert.equal((await drainControlResponse(request('business'), env)).status, 404)
  assert.equal((await drainControlResponse(request(), { ...env, HZY_TEST_DRAIN_CONTROL_ENABLED: undefined })).status, 404)
  assert.equal((await drainControlResponse(request('control', 'other.invalid'), env)).status, 404)
  assert.equal((await drainControlResponse(request('control', undefined, 'other'), env)).status, 403)
  assert.equal(calls, 0)
  assert.equal((await drainControlResponse(request(), env)).status, 200)
  assert.equal(calls, 1)
})
