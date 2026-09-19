import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as tenantGatewayModule from '../src/index.js'

const gatewayRoot = fileURLToPath(new URL('..', import.meta.url))
const tenantGateway = tenantGatewayModule.default

test('policy sync uses its own signed Console Binding path without business drains', async () => {
  const calls = []
  const env = schedulerEnv({ HZY_POLICY_SYNC_HOSTS: 'policy-test.huizhi.yun', HZY_CONSOLE_SERVICE: {
    async fetch(input, init) {
      const request = new Request(input, init)
      calls.push(request)
      return Response.json({ code: 0 })
    }
  } })
  const results = await tenantGatewayModule.runScheduledPolicyBundleSync(env, async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === '/internal/resolve') return Response.json({ data: resolvedTenantRecord('policy-test') })
    if (path === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
    throw new Error('unexpected network call')
  })
  assert.equal(results[0].ok, true)
  assert.equal(calls.length, 1)
  const request = calls[0]
  const h = request.headers
  assert.equal(new URL(request.url).pathname, '/api/internal/policy-bundle/sync')
  assert.equal(h.get('x-hzy-app-code'), 'console')
  assert.equal(h.get('x-hzy-deployment'), 'console-policy-test')
  assert.equal(calls[0].signal?.aborted, false)
  const canonical = ['POST', '/api/internal/policy-bundle/sync', h.get('x-request-id'), 'policy-test',
    'console-policy-test', 'console', 'prod', 'https://runtime-policy-test.example.test', 'policy-test.huizhi.yun', h.get('x-hzy-scheduler-issued-at')].join('\n')
  assert.equal(h.get('x-hzy-scheduler-signature'), createHmac('sha256', 'gateway-secret').update(canonical).digest('hex'))
})

test('public HTTP cannot invoke policy sync', async () => {
  const response = await tenantGateway.fetch(new Request('https://tenant-a.huizhi.yun/api/internal/policy-bundle/sync', { method: 'POST' }), schedulerEnv())
  assert.equal(response.status, 404)
})

function schedulerEnv(overrides = {}) {
  return {
    HZY_TENANT_GATEWAY_SCHEDULER_REGISTRY_URL: 'https://registry.example.test/internal/tenant-scheduler',
    HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://registry.example.test/internal/resolve',
    HZY_PLATFORM_INTERNAL_TOKEN: 'registry-secret',
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'gateway-secret',
    HZY_AIMS_ORIGIN: 'https://aims-worker.example.test',
    HZY_ALTOC_ORIGIN: 'https://altoc-worker.example.test',
    HZY_FINANCE_ORIGIN: 'https://finance-worker.example.test',
    HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test',
    HZY_PEOPLE_ORIGIN: 'https://people-worker.example.test',
    HZY_WORKFLOW_ORIGIN: 'https://workflow-worker.example.test',
    HZY_TENANT_GATEWAY_SCHEDULER_PAGE_SIZE: '2',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_PAGES: '2',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_TENANTS: '3',
    HZY_TENANT_GATEWAY_SCHEDULER_CONCURRENCY: '2',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_WALL_TIME_MS: '1000',
    HZY_TENANT_GATEWAY_SCHEDULER_SHARD_COUNT: '4',
    HZY_TENANT_GATEWAY_SCHEDULER_SHARD_INDEX: '1',
    HZY_POLICY_SYNC_CONSOLE_TIMEOUT_MS: '100000',
    ...overrides
  }
}

function tenantRecord(code) {
  return {
    host: `${code}.huizhi.yun`,
    tenantCode: code,
    environment: 'prod',
    appCodes: ['aims', 'altoc', 'console', 'people', 'workflow', 'finance']
  }
}

function resolvedTenantRecord(code) {
  return {
    host: `${code}.huizhi.yun`,
    tenantCode: code,
    deploymentCode: `dep-${code}`,
    environment: 'prod',
    apps: {
      aims: { origin: 'https://aims-worker.example.test' },
      altoc: { origin: 'https://altoc-worker.example.test' },
      people: { origin: 'https://people-worker.example.test' },
      workflow: { origin: 'https://workflow-worker.example.test' },
      console: { deploymentCode: `console-${code}` },
      finance: { origin: 'https://finance-worker.example.test' }
    },
    dataRuntime: {
      endpoint: `https://runtime-${code}.example.test`,
      runtimeCode: `${code}-prod-tenant-runtime`,
      audience: 'data-runtime'
    }
  }
}

function fakeSchedulerContext() {
  const waits = []
  return {
    waits,
    context: {
      waitUntil(promise) {
        waits.push(Promise.resolve(promise))
      }
    }
  }
}

async function runScheduled(env, fetchImpl, dependencies = {}) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    const controller = { cron: '*/5 * * * *', scheduledTime: 1_782_000_000_000, type: 'scheduled' }
    if (typeof tenantGatewayModule.runScheduledIntegrationDrains === 'function') {
      return await tenantGatewayModule.runScheduledIntegrationDrains(controller, env, {
        fetchImpl,
        ...dependencies
      })
    }
    assert.equal(typeof tenantGateway.scheduled, 'function', 'Tenant Gateway scheduled handler or runScheduledIntegrationDrains export is required')
    const { waits, context } = fakeSchedulerContext()
    const result = await tenantGateway.scheduled(
      controller,
      env,
      context,
      { fetchImpl, ...dependencies }
    )
    await Promise.all(waits)
    return result
  } finally {
    globalThis.fetch = originalFetch
  }
}

function asRequest(input, init) {
  return input instanceof Request ? input : new Request(input, init)
}

test('wrangler declares a cron without embedding tenant runtime credentials', () => {
  const config = JSON.parse(readFileSync(`${gatewayRoot}/wrangler.jsonc`, 'utf8'))
  assert.ok(Array.isArray(config.triggers?.crons) && config.triggers.crons.length > 0, 'Tenant Gateway cron trigger is required')
  assert.deepEqual(
    Object.fromEntries((config.services || []).map(item => [item.binding, item.service])),
    {
      HZY_PLATFORM_SERVICE: 'hzy-platform',
      HZY_CONSOLE_SERVICE: 'hzy-console-prod',
      HZY_AIMS_SERVICE: 'hzy-aims',
      HZY_ALTOC_SERVICE: 'hzy-altoc',
      HZY_FINANCE_SERVICE: 'hzy-finance',
      HZY_PEOPLE_SERVICE: 'hzy-people',
      HZY_WORKFLOW_SERVICE: 'hzy-workflow'
    },
    'trusted scheduler calls must use same-account Worker service bindings'
  )
  const serializedVars = JSON.stringify(config.vars || {}).toLowerCase()
  assert.doesNotMatch(serializedVars, /runtime.*token|authorization|bearer/)
})

test('scheduled registry reads prefer the Platform service binding over the public edge', async () => {
  const serviceCalls = []
  let publicCalls = 0
  const platformService = {
    async fetch(input, init = {}) {
      const request = asRequest(input, init)
      serviceCalls.push(request)
      return Response.json({ data: { items: [], nextCursor: null } })
    }
  }
  await runScheduled(schedulerEnv({ HZY_PLATFORM_SERVICE: platformService }), async () => {
    publicCalls += 1
    throw new Error('public edge fetch must not be used for scheduler registry reads')
  })
  assert.equal(serviceCalls.length, 1)
  assert.equal(publicCalls, 0)
  assert.equal(new URL(serviceCalls[0].url).pathname, '/internal/tenant-scheduler')
})

test('scheduled registry enumeration is bounded, sharded, tenant-scoped and wakes only approved drain apps', async () => {
  const pageCalls = []
  const resolveCalls = []
  const wakeCalls = []
  const logs = []
  const pages = {
    '': { items: [tenantRecord('tenant-a'), tenantRecord('tenant-b')], nextCursor: 'page-2' },
    'page-2': { items: [tenantRecord('tenant-c'), tenantRecord('tenant-d')], nextCursor: 'page-3' }
  }
  const fakeFetch = async (input, init = {}) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') {
      pageCalls.push(request)
      const page = pages[url.searchParams.get('cursor') || ''] || { items: [], nextCursor: null }
      return Response.json({ data: page })
    }
    if (url.pathname === '/internal/resolve') {
      resolveCalls.push(request)
      const host = url.searchParams.get('host') || ''
      return Response.json({ data: resolvedTenantRecord(host.split('.')[0]) })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') {
      const body = await request.clone().json()
      return Response.json({
        data: {
          token: `bootstrap-${body.tenantCode}`,
          expiresAt: new Date(Date.now() + 90_000).toISOString()
        }
      })
    }
    wakeCalls.push(request)
    return Response.json({ ok: true })
  }
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args) => logs.push(args.join(' '))
  console.error = (...args) => logs.push(args.join(' '))
  try {
    await runScheduled(schedulerEnv(), fakeFetch, { now: () => 100 })
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  assert.equal(pageCalls.length, 2, 'registry page count must be bounded')
  assert.equal(resolveCalls.length, 3, 'only bounded page items may be resolved')
  for (const request of pageCalls) {
    const url = new URL(request.url)
    assert.equal(url.searchParams.get('limit'), '2')
    assert.ok(url.searchParams.get('slot'), 'scheduler slot is required')
    assert.equal(url.searchParams.get('shardIndex'), '1')
    assert.equal(url.searchParams.get('shardCount'), '4')
    assert.equal(request.headers.get('authorization'), 'Bearer registry-secret')
  }
  assert.equal(wakeCalls.length, 18, 'maxTenants=3 should wake all six durable outbox apps for three tenants')
  for (const request of wakeCalls) {
    const url = new URL(request.url)
    assert.ok(
      ['aims-worker.example.test', 'altoc-worker.example.test', 'console-worker.example.test', 'finance-worker.example.test', 'people-worker.example.test', 'workflow-worker.example.test'].includes(url.hostname),
      `unexpected wake target ${url}`
    )
    const appCode = url.hostname.split('-')[0]
    assert.equal(url.pathname, appCode === 'console'
      ? '/api/internal/integration-operations/drain'
      : `/${appCode}/api/internal/integration-operations/drain`)
    const tenant = request.headers.get('x-hzy-tenant')
    assert.ok(['tenant-a', 'tenant-b', 'tenant-c'].includes(tenant))
    assert.equal(request.headers.get('x-hzy-deployment'), appCode === 'console' ? `console-${tenant}` : `dep-${tenant}`)
    assert.equal(request.headers.get('x-hzy-app-code'), appCode)
    assert.equal(request.headers.get('x-hzy-gateway'), 'tenant-gateway')
    assert.equal(request.headers.get('x-hzy-gateway-token'), 'gateway-secret')
    assert.equal(request.headers.get('x-hzy-scheduler'), 'tenant-gateway')
    assert.ok(request.headers.get('x-hzy-scheduler-issued-at'))
    assert.match(request.headers.get('x-hzy-scheduler-signature') || '', /^[a-f0-9]{64}$/)
    assert.equal(request.headers.get('x-forwarded-host'), `${tenant}.huizhi.yun`)
    assert.equal(request.headers.get('x-hzy-data-runtime-url'), `https://runtime-${tenant}.example.test`)
    assert.equal(request.headers.get('x-hzy-data-runtime-code'), `${tenant}-prod-tenant-runtime`)
    assert.equal(request.headers.get('x-hzy-data-runtime-token'), `bootstrap-${tenant}`)
    // 走查 ISSUE-B-025：scheduler wake 必须和普通代理一样带受信服务路由目录。
    // 目标应用的 Foundation 用它把 app-code / deployment / forwarded-prefix
    // 原子改写到目标应用；缺了它跨应用调用会剥掉这三个字段，目标应用无法向
    // Console 自证身份，所有 gateway-drain 重试 100% 返回 503。
    const wakeServiceRoutes = request.headers.get('x-hzy-service-routes')
    assert.ok(wakeServiceRoutes, 'scheduler wake must carry the trusted service route catalog')
    const wakeCatalog = JSON.parse(wakeServiceRoutes)
    assert.ok(wakeCatalog.altoc?.origin, 'catalog must resolve altoc origin')
    assert.equal(wakeCatalog.altoc.deploymentCode, `dep-${tenant}`)
    assert.equal(
      request.headers.get('x-hzy-console-target-deployment'),
      appCode === 'people' ? `console-${tenant}` : null,
      'only People may receive the Console lifecycle target binding'
    )
    const body = await request.clone().text()
    assert.doesNotMatch(request.url, /runtime-secret|registry-secret|gateway-secret/)
    assert.equal(body, '')
  }
  assert.doesNotMatch(logs.join('\n'), /runtime-secret|registry-secret|gateway-secret/)
})

test('one app wake failure is isolated and concurrency stays bounded', async () => {
  const wakeCalls = []
  let active = 0
  let maxActive = 0
  const fakeFetch = async (input, init = {}) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') {
      return Response.json({ data: { items: [tenantRecord('bad'), tenantRecord('good-a'), tenantRecord('good-b')], nextCursor: null } })
    }
    if (url.pathname === '/internal/resolve') {
      const host = url.searchParams.get('host') || ''
      return Response.json({ data: resolvedTenantRecord(host.split('.')[0]) })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') {
      const body = await request.clone().json()
      return Response.json({
        data: {
          token: `bootstrap-${body.tenantCode}`,
          expiresAt: new Date(Date.now() + 90_000).toISOString()
        }
      })
    }
    wakeCalls.push(request)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active -= 1
    if (request.headers.get('x-hzy-tenant') === 'bad' && url.hostname.startsWith('aims-')) {
      throw new Error('simulated network failure')
    }
    return Response.json({ ok: true })
  }

  await runScheduled(schedulerEnv({
    HZY_TENANT_GATEWAY_SCHEDULER_PAGE_SIZE: '3',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_TENANTS: '3'
  }), fakeFetch, { now: () => 100 })

  assert.ok(maxActive > 1, 'scheduler should use bounded parallelism rather than fully serial execution')
  assert.ok(maxActive <= 2, `scheduler exceeded concurrency limit: ${maxActive}`)
  for (const tenant of ['bad', 'good-a', 'good-b']) {
    assert.equal(wakeCalls.filter(request => request.headers.get('x-hzy-tenant') === tenant).length, 6, `${tenant} must not be starved by another tenant failure`)
  }
})

test('busy lifecycle drains run claimed batches concurrently and continue inside the same scheduler wake', async () => {
  const peopleDrain = readFileSync(`${gatewayRoot}/../../../people/server/utils/directoryLifecycleOperation.ts`, 'utf8')
  const consoleDrain = readFileSync(`${gatewayRoot}/../../../console/server/utils/platformLifecycleOperation.ts`, 'utf8')
  assert.match(peopleDrain, /Promise\.allSettled\(operations\.map/)
  assert.match(consoleDrain, /Promise\.allSettled\(operations\.map/)

  const wakeCounts = new Map()
  let activeWakes = 0
  let maxActiveWakes = 0
  const fakeFetch = async (input, init = {}) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') {
      return Response.json({
        data: {
          items: [{ ...tenantRecord('tenant-a'), appCodes: ['console', 'people'] }],
          nextCursor: null
        }
      })
    }
    if (url.pathname === '/internal/resolve') {
      return Response.json({ data: resolvedTenantRecord('tenant-a') })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') {
      return Response.json({
        data: {
          token: 'bootstrap-tenant-a',
          expiresAt: new Date(Date.now() + 90_000).toISOString()
        }
      })
    }

    const appCode = url.pathname === '/api/internal/integration-operations/drain' ? 'console' : 'people'
    const count = (wakeCounts.get(appCode) || 0) + 1
    wakeCounts.set(appCode, count)
    activeWakes += 1
    maxActiveWakes = Math.max(maxActiveWakes, activeWakes)
    await new Promise(resolve => setTimeout(resolve, 2))
    activeWakes -= 1
    const claimed = count === 1 ? 10 : 0
    return Response.json({
      code: 0,
      data: appCode === 'console' ? { result: { claimed } } : { claimed }
    })
  }

  await runScheduled(schedulerEnv({
    HZY_TENANT_GATEWAY_SCHEDULER_CONCURRENCY: '2'
  }), fakeFetch, { now: () => 100 })

  assert.equal(wakeCounts.get('console'), 2)
  assert.equal(wakeCounts.get('people'), 2)
  assert.ok(maxActiveWakes > 1, 'independent app drains should not consume the tenant wall budget serially')
})

test('wall-clock budget stops further pages and an empty registry completes normally', async () => {
  let registryCalls = 0
  let wakeCalls = 0
  let now = 0
  const budgetFetch = async (input, init = {}) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') {
      registryCalls += 1
      return Response.json({ data: { items: [tenantRecord(`tenant-${registryCalls}`)], nextCursor: `page-${registryCalls + 1}` } })
    }
    if (url.pathname === '/internal/resolve') {
      const host = url.searchParams.get('host') || ''
      return Response.json({ data: resolvedTenantRecord(host.split('.')[0]) })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') {
      const body = await request.clone().json()
      return Response.json({
        data: {
          token: `bootstrap-${body.tenantCode}`,
          expiresAt: new Date(Date.now() + 90_000).toISOString()
        }
      })
    }
    wakeCalls += 1
    now += 600
    return Response.json({ ok: true })
  }
  await runScheduled(schedulerEnv({
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_PAGES: '10',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_TENANTS: '10',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_WALL_TIME_MS: '1000'
  }), budgetFetch, { now: () => now })
  assert.ok(registryCalls < 10, 'wall-clock budget must stop registry pagination')
  assert.ok(wakeCalls <= 4, 'wall-clock budget must stop new tenant wakes')

  let emptyWakeCalls = 0
  const emptyFetch = async (input, init = {}) => {
    const request = asRequest(input, init)
    if (new URL(request.url).pathname === '/internal/tenant-scheduler') {
      return Response.json({ data: { items: [], nextCursor: null } })
    }
    emptyWakeCalls += 1
    return Response.json({ ok: true })
  }
  await runScheduled(schedulerEnv(), emptyFetch, { now: () => 0 })
  assert.equal(emptyWakeCalls, 0)
})

test('user HTTP cannot invoke the internal scheduler wake path', async () => {
  let fetchCalls = 0
  const forwarded = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    fetchCalls += 1
    forwarded.push(asRequest(input, init))
    return Response.json({ ok: true })
  }
  try {
    const response = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/aims/api/internal/integration-operations/drain', {
        method: 'POST',
        headers: { 'x-hzy-scheduler': 'tenant-gateway' }
      }),
      {
        HZY_ALLOWED_TENANTS: 'acme',
        HZY_DEFAULT_TENANT: 'acme',
        HZY_AIMS_ORIGIN: 'https://aims-worker.example.test'
      }
    )
    assert.ok(response.status === 404 || response.status === 405, `unexpected status ${response.status}`)
    assert.equal(fetchCalls, 0, 'internal scheduler path must not be proxied from user HTTP')

    const consoleWake = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/api/internal/integration-operations/drain', { method: 'POST' }),
      { HZY_ALLOWED_TENANTS: 'acme', HZY_DEFAULT_TENANT: 'acme' }
    )
    assert.equal(consoleWake.status, 404)
    assert.equal(fetchCalls, 0, 'Console scheduler path must not be proxied from user HTTP')

    const peopleWake = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/people/api/internal/integration-operations/drain', { method: 'POST' }),
      { HZY_ALLOWED_TENANTS: 'acme', HZY_DEFAULT_TENANT: 'acme' }
    )
    assert.equal(peopleWake.status, 404)
    assert.equal(fetchCalls, 0, 'People scheduler path must not be proxied from user HTTP')

    const workflowWake = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/workflow/api/internal/integration-operations/drain', { method: 'POST' }),
      { HZY_ALLOWED_TENANTS: 'acme', HZY_DEFAULT_TENANT: 'acme' }
    )
    assert.equal(workflowWake.status, 404)
    assert.equal(fetchCalls, 0, 'Workflow scheduler path must not be proxied from user HTTP')

    const nitroTaskResponse = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/aims/_nitro/tasks/integration-operations:drain', { method: 'POST' }),
      { HZY_ALLOWED_TENANTS: 'acme', HZY_DEFAULT_TENANT: 'acme' }
    )
    assert.equal(nitroTaskResponse.status, 404)
    assert.equal(fetchCalls, 0, 'Nitro task HTTP paths must not be proxied')

    const normalResponse = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/aims/api/v1/projects', {
        headers: {
          'x-hzy-scheduler': 'tenant-gateway',
          'x-hzy-console-target-deployment': 'attacker-console'
        }
      }),
      {
        HZY_ALLOWED_TENANTS: 'acme',
        HZY_DEFAULT_TENANT: 'acme',
        HZY_AIMS_ORIGIN: 'https://aims-worker.example.test'
      }
    )
    assert.equal(normalResponse.status, 200)
    assert.equal(forwarded.length, 1)
    assert.equal(forwarded[0].headers.get('x-hzy-scheduler'), null, 'ordinary HTTP must strip scheduler identity')
    assert.equal(forwarded[0].headers.get('x-hzy-console-target-deployment'), null, 'ordinary HTTP must strip Console target binding')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// 走查 ISSUE-B-025：finance 此前不在 SCHEDULER_APPS 中，即时派发一旦失败就被
// catch 吞成 pending，operation 永久停摆且无任何错误记录；其静态 drain 又因缺
// 专属 Console service client 而被 HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED
// 关闭，等于完全没有重试兜底。
test('all durable outbox apps are woken for scheduled integration operation drain', async () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  const schedulerApps = source.match(/const SCHEDULER_APPS = new Set\(\[([^\]]*)\]\)/)
  assert.ok(schedulerApps, 'SCHEDULER_APPS declaration must be present')
  for (const app of ['aims', 'altoc', 'console', 'finance', 'people', 'workflow']) {
    assert.match(schedulerApps[1], new RegExp(`'${app}'`), `${app} must be woken for drain`)
  }
  // 每个被唤醒的应用都必须有 Service Binding，否则唤醒会走公网被 WAF 拦掉。
  const bindings = source.match(/const APP_SERVICE_BINDINGS = Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(bindings, 'APP_SERVICE_BINDINGS declaration must be present')
  for (const app of ['aims', 'altoc', 'console', 'finance', 'people', 'workflow']) {
    assert.match(bindings[1], new RegExp(`${app}: '`), `${app} must have a service binding`)
  }
  // 绑定必须同时在 wrangler 配置里声明，否则运行时取不到。
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  for (const binding of ['HZY_AIMS_SERVICE', 'HZY_ALTOC_SERVICE', 'HZY_CONSOLE_SERVICE', 'HZY_FINANCE_SERVICE', 'HZY_PEOPLE_SERVICE', 'HZY_WORKFLOW_SERVICE']) {
    assert.match(config, new RegExp(binding), `${binding} must be declared in wrangler.jsonc`)
  }
})

test('unified Aims storage selection is signed per tenant without changing legacy wakes', async () => {
  const wakes = []
  await runScheduled(schedulerEnv(), async (input, init) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') return Response.json({ data: { items: [{ ...tenantRecord('unified-signature'), appCodes: ['aims'] }], nextCursor: null } })
    if (url.pathname === '/internal/resolve') {
      const record = resolvedTenantRecord('unified-signature')
      record.apps.aims.enterpriseScheduler = { storage: 'unified', generation: '7' }
      return Response.json({ data: record })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
    wakes.push(request)
    return Response.json({ code: 0 })
  }, { now: () => 100 })
  assert.equal(wakes.length, 1)
  const h = wakes[0].headers
  assert.equal(h.get('x-hzy-scheduler-storage'), 'unified')
  assert.equal(h.get('x-hzy-scheduler-generation'), '7')
  const canonical = ['POST', '/api/internal/integration-operations/drain', h.get('x-request-id'),
    'unified-signature', 'dep-unified-signature', 'aims', 'prod', 'https://runtime-unified-signature.example.test',
    'unified-signature.huizhi.yun', 'enterprise-scheduler-v1', 'unified', '7', h.get('x-hzy-scheduler-issued-at')].join('\n')
  assert.equal(h.get('x-hzy-scheduler-signature'), createHmac('sha256', 'gateway-secret').update(canonical).digest('hex'))
})

test('disabled persisted scheduler selection never wakes a legacy worker', async () => {
  let wakes = 0
  await runScheduled(schedulerEnv(), async (input, init) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') return Response.json({ data: { items: [{ ...tenantRecord('disabled-selection'), appCodes: ['aims'] }], nextCursor: null } })
    if (url.pathname === '/internal/resolve') {
      const record = resolvedTenantRecord('disabled-selection')
      record.apps.aims.enterpriseScheduler = { storage: 'disabled', generation: '7' }
      return Response.json({ data: record })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
    wakes++
    return Response.json({ code: 0 })
  }, { now: () => 100 })
  assert.equal(wakes, 0)
})

test('malformed explicit scheduler selections never silently choose legacy storage', async () => {
  const selections = [{}, null, { storage: 'unified', generation: 7 }, { storage: 'unified', generation: ' 7' },
    { storage: 'unified', generation: '18446744073709551616' }, { storage: 'legacy', generation: '7' }]
  for (const [index, selection] of selections.entries()) {
    const code = `malformed-selection-${index}`
    let wakes = 0
    await runScheduled(schedulerEnv(), async (input, init) => {
      const request = asRequest(input, init)
      const url = new URL(request.url)
      if (url.pathname === '/internal/tenant-scheduler') return Response.json({ data: { items: [{ ...tenantRecord(code), appCodes: ['aims'] }], nextCursor: null } })
      if (url.pathname === '/internal/resolve') {
        const record = resolvedTenantRecord(code)
        record.apps.aims.enterpriseScheduler = selection
        return Response.json({ data: record })
      }
      if (url.pathname === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
      wakes++
      return Response.json({ code: 0 })
    }, { now: () => 100 })
    assert.equal(wakes, 0, `selection ${index} must fail closed`)
  }
})

test('recovered Aims storage selection is signed per tenant without changing legacy wakes', async () => {
  const wakes = []
  await runScheduled(schedulerEnv(), async (input, init) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') return Response.json({ data: { items: [{ ...tenantRecord('recovered-signature'), appCodes: ['aims'] }], nextCursor: null } })
    if (url.pathname === '/internal/resolve') {
      const record = resolvedTenantRecord('recovered-signature')
      record.apps.aims.enterpriseScheduler = { storage: 'recovered', generation: '7' }
      return Response.json({ data: record })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
    wakes.push(request)
    return Response.json({ code: 0 })
  }, { now: () => 100 })
  assert.equal(wakes.length, 1)
  const h = wakes[0].headers
  assert.equal(h.get('x-hzy-scheduler-storage'), 'recovered')
  assert.equal(h.get('x-hzy-scheduler-generation'), '7')
  const canonical = ['POST', '/api/internal/integration-operations/drain', h.get('x-request-id'),
    'recovered-signature', 'dep-recovered-signature', 'aims', 'prod', 'https://runtime-recovered-signature.example.test',
    'recovered-signature.huizhi.yun', 'enterprise-scheduler-v1', 'recovered', '7', h.get('x-hzy-scheduler-issued-at')].join('\n')
  assert.equal(h.get('x-hzy-scheduler-signature'), createHmac('sha256', 'gateway-secret').update(canonical).digest('hex'))
})

test('Assets is never woken without a persisted unified or recovered selection', async () => {
  for (const selection of [undefined, { storage: 'disabled', generation: '7' }]) {
    const wakes = []
    await runScheduled(schedulerEnv(), async (input, init) => {
      const request = asRequest(input, init)
      const url = new URL(request.url)
      if (url.pathname === '/internal/tenant-scheduler') return Response.json({ data: { items: [{ ...tenantRecord('assets-legacy'), appCodes: ['assets'] }], nextCursor: null } })
      if (url.pathname === '/internal/resolve') {
        const record = resolvedTenantRecord('assets-legacy')
        record.apps.assets = { ...(record.apps.assets || {}), ...(selection ? { enterpriseScheduler: selection } : {}) }
        return Response.json({ data: record })
      }
      if (url.pathname === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
      wakes.push(request)
      return Response.json({ code: 0 })
    }, { now: () => 100 })
    assert.equal(wakes.length, 0, `assets woken with selection ${JSON.stringify(selection)}`)
  }
})

test('unified Assets storage selection is signed for the Assets wake', async () => {
  const wakes = []
  await runScheduled(schedulerEnv(), async (input, init) => {
    const request = asRequest(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/internal/tenant-scheduler') return Response.json({ data: { items: [{ ...tenantRecord('assets-unified'), appCodes: ['assets'] }], nextCursor: null } })
    if (url.pathname === '/internal/resolve') {
      const record = resolvedTenantRecord('assets-unified')
      record.apps.assets = { ...(record.apps.assets || {}), enterpriseScheduler: { storage: 'unified', generation: '9' } }
      return Response.json({ data: record })
    }
    if (url.pathname === '/internal/runtime-bootstrap-token') return Response.json({ data: { token: 'bootstrap', expiresAt: new Date(Date.now() + 90000).toISOString() } })
    wakes.push(request)
    return Response.json({ code: 0 })
  }, { now: () => 100 })
  assert.equal(wakes.length, 1)
  const h = wakes[0].headers
  assert.equal(new URL(wakes[0].url).pathname.endsWith('/api/internal/integration-operations/drain'), true)
  assert.equal(h.get('x-hzy-app-code'), 'assets')
  assert.equal(h.get('x-hzy-scheduler-storage'), 'unified')
  assert.equal(h.get('x-hzy-scheduler-generation'), '9')
  assert.equal(h.get('x-hzy-scheduler-signature')?.length, 64)
})
