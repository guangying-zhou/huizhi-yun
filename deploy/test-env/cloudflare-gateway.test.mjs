import test from 'node:test'
import assert from 'node:assert/strict'
import { businessApiRoutes } from '../../enterprise/composition/business-api-routes.generated.mjs'
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
    assert.equal(r.status, app === 'altoc' ? 404 : 503)
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

test('Altoc G1/G2 reaches only the Enterprise binding with all three target identity fields', async () => {
 const calls=[]
 const env={HZY_ENTERPRISE_PILOT:'true',HZY_ALLOWED_TENANTS:'C000001',HZY_TENANT_GATEWAY_INTERNAL_TOKEN:'test-key',HZY_TENANT_GATEWAY_REGISTRY_JSON:JSON.stringify({domains:{'hzy-test.huizhi.yun':{tenantCode:'C000001',deploymentCode:'wiztek-test-console',environment:'test',apps:{console:{deploymentCode:'wiztek-test-console'},enterprise:{deploymentCode:'C000001-test-enterprise'}}}}}),HZY_ENTERPRISE_SERVICE:{fetch(input,init){calls.push({input,init});return new Response('host')}}}
 for(const folder of ['customers','contracts','payments','leads','opportunities','quotes'])for(const path of [`/altoc/api/v1/${folder}`,`/altoc/api/v1/${folder}/7`]){
  assert.equal((await gateway.fetch(new Request('https://hzy-test.huizhi.yun'+path,{headers:{'x-hzy-app-code':'altoc','x-hzy-deployment':'forged','x-forwarded-prefix':'/altoc'}}),env)).status,200)
  const headers=new Headers(calls.at(-1).init.headers)
  assert.equal(headers.get('x-hzy-app-code'),'enterprise');assert.equal(headers.get('x-hzy-deployment'),'C000001-test-enterprise');assert.equal(headers.get('x-forwarded-prefix'),'')
  for(const method of ['POST','PUT','PATCH','DELETE']) {
   const registered = businessApiRoutes.some(([allowed, pattern]) => allowed === method && pattern.replace(/:[A-Za-z]+/g, '7') === path)
   assert.equal((await gateway.fetch(new Request('https://hzy-test.huizhi.yun'+path,{method}),env)).status, registered ? 200 : 503)
  }
 }
 for (const [method, pattern] of businessApiRoutes.filter(([, path]) => path.startsWith('/finance/api/v1/') || path.startsWith('/altoc/api/v1/'))) {
  const path = pattern.replace(/:[A-Za-z]+/g, '7')
  assert.equal((await gateway.fetch(new Request('https://hzy-test.huizhi.yun' + path, { method, headers: { cookie: 'session=fixture', 'x-hzy-app-code': 'forged' } }), env)).status, 200)
  const headers = new Headers(calls.at(-1).init.headers)
  assert.equal(headers.get('x-hzy-app-code'), 'enterprise')
  assert.equal(headers.get('x-hzy-deployment'), 'C000001-test-enterprise')
  assert.equal(headers.get('x-forwarded-prefix'), '')
  assert.equal(headers.get('cookie'), 'session=fixture')
 }
 for (const method of ['GET', 'HEAD']) assert.equal((await gateway.fetch(new Request('https://hzy-test.huizhi.yun/finance/bank-accounts', { method }), env)).status, 200)
 for(const path of ['/altoc/settings','/altoc/api/v1/contracts/7/unknown'])assert.equal((await gateway.fetch(new Request('https://hzy-test.huizhi.yun'+path),env)).status,503)
})
