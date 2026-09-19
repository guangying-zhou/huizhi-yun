import test from 'node:test'
import assert from 'node:assert/strict'
import gateway, {
  TEST_INTEGRATION_DRAIN_CRON,
  TEST_POLICY_SYNC_CRON,
  runTestGatewayScheduled
} from './cloudflare-gateway.mjs'

test('scheduled crons dispatch policy sync and integration drains exactly once', async () => {
  const calls = []
  const dependencies = {
    async runPolicySync(env) {
      calls.push(['policy', env])
      return ['policy-result']
    },
    async runIntegrationDrains(controller, env) {
      calls.push(['drain', controller.cron, env])
      return { stoppedBy: 'empty' }
    }
  }
  const env = { marker: 'test-only' }

  assert.deepEqual(
    await runTestGatewayScheduled({ cron: TEST_POLICY_SYNC_CRON }, env, dependencies),
    ['policy-result']
  )
  assert.deepEqual(calls, [['policy', env]])

  calls.length = 0
  assert.deepEqual(
    await runTestGatewayScheduled({ cron: TEST_INTEGRATION_DRAIN_CRON }, env, dependencies),
    { stoppedBy: 'empty' }
  )
  assert.deepEqual(calls, [['drain', TEST_INTEGRATION_DRAIN_CRON, env]])
})

test('scheduled handler registers only one execution with waitUntil', async () => {
  const waits = []
  const result = await gateway.scheduled(
    { cron: TEST_POLICY_SYNC_CRON },
    { HZY_POLICY_SYNC_HOSTS: '' },
    { waitUntil(promise) { waits.push(promise) } }
  )
  assert.deepEqual(result, [])
  assert.equal(waits.length, 1)
  assert.deepEqual(await waits[0], [])
})

test('applications without test bindings cannot fall back to production origins', async () => {
  for (const app of ['altoc', 'people', 'workflow', 'webdev', 'collab', 'directory-connector']) {
    const r = await gateway.fetch(new Request(`https://hzy-test.huizhi.yun/${app}/`), {})
    assert.equal(r.status, 503)
  }
})

// Codocs has a test Worker and a service binding, so it must reach that binding
// instead of the blanket 503 — and must never fall back to a non-test origin.
test('codocs routes to its test service binding', async () => {
  let seen = null
  const r = await gateway.fetch(new Request('https://hzy-test.huizhi.yun/codocs/'), {
    HZY_ALLOWED_TENANTS: 'C000001',
    HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'hzy-test.huizhi.yun': {
      tenantCode: 'C000001', deploymentCode: 'wiztek-test-console', environment: 'test',
      apps: { console: { deploymentCode: 'wiztek-test-console' }, codocs: { deploymentCode: 'C000001-test-codocs' } }
    } } }),
    HZY_CODOCS_ORIGIN: 'https://codocs.test.invalid',
    HZY_CODOCS_SERVICE: { fetch(input, init) { seen = { input: String(input), init }; return new Response('ok') } }
  })
  assert.equal(r.status, 200)
  assert.ok(seen, 'codocs request must reach the service binding')
  assert.match(seen.input, /^https:\/\/codocs\.test\.invalid\//)
  const headers = new Headers(seen.init.headers)
  assert.equal(headers.get('x-hzy-app-code'), 'codocs')
  assert.equal(headers.get('x-hzy-deployment'), 'C000001-test-codocs')
})

test('maintenance sync requires exact test host, POST and gateway credential', async () => {
  for (const [url, method, token] of [
    ['https://other.huizhi.yun/__test/policy-sync', 'POST', 'test-key'],
    ['https://hzy-test.huizhi.yun/__test/policy-sync', 'GET', 'test-key'],
    ['https://hzy-test.huizhi.yun/__test/policy-sync', 'POST', 'wrong'],
    ['https://hzy-test.huizhi.yun/__test/policy-sync', 'POST', ''],
  ]) {
    let called = false
    const r = await gateway.fetch(new Request(url, { method, headers: { authorization: `Bearer ${token}` } }), {
      HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'test-key',
      HZY_CONSOLE_SERVICE: { fetch() { called = true; throw Error('must not call') } },
    })
    assert.equal(r.status, 404); assert.equal(called, false)
  }
})
