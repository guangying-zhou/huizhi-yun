import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { createLogger, createRedactor, installConsoleRedaction } from '../log.mjs'
import { createScheduler, nextBoundary } from '../scheduler.mjs'
import { configFor, randomSecret, rawRequest, registryRecord, startGateway, startUpstream } from './fixtures.mjs'

function fakeClock(start) {
  let current = start
  const timers = []
  return {
    now: () => current,
    set: (value) => { current = value },
    setTimer: (fn, delay) => { const timer = { fn, at: current + delay, delay }; timers.push(timer); return timer },
    clearTimer: (timer) => { timer.cleared = true },
    timers
  }
}

function captureLog() {
  const lines = []
  const redact = createRedactor([])
  return { lines, log: createLogger(redact, line => lines.push(line)), events: () => lines.map(line => JSON.parse(line)) }
}

test('ticks are aligned to UTC minute boundaries without jitter or drift', async () => {
  const start = Date.UTC(2026, 9, 1, 12, 3, 17, 500)
  const clock = fakeClock(start)
  const runs = []
  const { log } = captureLog()
  const scheduler = createScheduler({
    jobs: [
      { name: 'drain', intervalMs: 5 * 60_000, run: async at => { runs.push(['drain', at]) } },
      { name: 'policy', intervalMs: 60_000, run: async at => { runs.push(['policy', at]) } }
    ],
    log, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer
  })
  scheduler.start()
  assert.deepEqual(clock.timers.map(timer => timer.delay), [102_500, 42_500])
  assert.equal(nextBoundary(start, 5 * 60_000), Date.UTC(2026, 9, 1, 12, 5))

  // Fire the drain timer 1.2 s late: the next one is still at 12:10:00.000.
  const [drainTimer] = clock.timers
  clock.set(drainTimer.at + 1200)
  drainTimer.fn()
  await scheduler.stop()
  assert.deepEqual(runs, [['drain', Date.UTC(2026, 9, 1, 12, 5)]])
  assert.equal(clock.timers[2].at, Date.UTC(2026, 9, 1, 12, 10))
})

test('a job never overlaps itself; skipped boundaries are counted', async () => {
  let release
  const blocker = new Promise(resolve => { release = resolve })
  let started = 0
  const { log, events } = captureLog()
  const scheduler = createScheduler({ jobs: [{ name: 'drain', intervalMs: 300_000, run: async () => { started += 1; await blocker } }], log })
  const first = scheduler.trigger('drain')
  await scheduler.trigger('drain')
  await scheduler.trigger('drain')
  assert.equal(started, 1)
  release()
  await first
  const snapshot = scheduler.snapshot().drain
  assert.equal(snapshot.skippedOverlaps, 2)
  assert.equal(snapshot.runs, 1)
  assert.equal(events().filter(event => event.event === 'gateway-scheduler-skipped').length, 2)
})

test('failures are counted and alerted without leaking error messages or secrets', async () => {
  const secret = randomSecret()
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZXJ2aWNlIn0.c2lnbmF0dXJlLXZhbHVl'
  const lines = []
  const log = createLogger(createRedactor([secret]), line => lines.push(line))
  let fail = true
  const scheduler = createScheduler({
    jobs: [{ name: 'drain', intervalMs: 300_000, run: async () => { if (fail) throw new TypeError(`upstream said ${secret} Bearer ${jwt}`); return { ok: 1 } } }],
    log,
    alertAfter: 2
  })
  await scheduler.trigger('drain')
  await scheduler.trigger('drain')
  let snapshot = scheduler.snapshot().drain
  assert.equal(snapshot.failures, 2)
  assert.equal(snapshot.consecutiveFailures, 2)
  assert.equal(snapshot.alerting, true)
  assert.equal(scheduler.degraded(), true)
  assert.deepEqual(snapshot.lastSummary, { stage: 'exception', errorName: 'TypeError' })
  const events = lines.map(line => JSON.parse(line))
  assert.deepEqual(events.map(event => event.event), ['gateway-scheduler-run', 'gateway-scheduler-alert'])
  const text = lines.join('\n')
  assert.equal(text.includes(secret), false)
  assert.equal(text.includes(jwt), false)
  assert.equal(text.includes('upstream said'), false)
  fail = false
  await scheduler.trigger('drain')
  snapshot = scheduler.snapshot().drain
  assert.equal(snapshot.consecutiveFailures, 0)
  assert.equal(snapshot.successes, 1)
  assert.equal(scheduler.degraded(), false)
})

test('console redaction masks configured secrets, bearer credentials, JWTs and OAuth query values', () => {
  const secret = randomSecret()
  const captured = []
  const target = { log: (...args) => captured.push(args), info() {}, warn() {}, error: (...args) => captured.push(args), debug() {} }
  const restore = installConsoleRedaction(createRedactor([secret]), target)
  target.error('Tenant scheduler wake failed', { responseSummary: `token=${secret} authorization: Bearer abc.def x-hzy-gateway-token: ${secret}` })
  target.log(new Error(`GET /cb?code=oauth-code-value&state=s1 with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-value-long`))
  restore()
  const text = JSON.stringify(captured)
  for (const leaked of [secret, 'abc.def', 'oauth-code-value', 'eyJhbGciOiJIUzI1NiJ9']) assert.equal(text.includes(leaked), false, leaked)
  assert.equal(text.includes('stack'), false)
})

function verifySignature(call, secret, path) {
  const h = call.headers
  const canonical = ['POST', path, h['x-request-id'], h['x-hzy-tenant'], h['x-hzy-deployment'], h['x-hzy-app-code'],
    h['x-hzy-environment'], h['x-hzy-data-runtime-url'], h['x-forwarded-host']]
  if (h['x-hzy-app-code'] === 'people') canonical.push(h['x-hzy-console-target-deployment'] || '')
  canonical.push(h['x-hzy-scheduler-issued-at'])
  return h['x-hzy-scheduler-signature'] === createHmac('sha256', secret).update(canonical.join('\n')).digest('hex')
}

async function gatewayWith(t, names, { record } = {}) {
  const upstreams = []
  for (const name of names) upstreams.push(await startUpstream(name))
  const config = configFor(upstreams)
  const platformCalls = []
  const gateway = await startGateway(config, { record: record ? () => record(config) : undefined, platformCalls })
  t.after(async () => {
    await gateway.close()
    for (const upstream of upstreams) await upstream.close()
  })
  return { config, gateway, platformCalls, upstream: Object.fromEntries(upstreams.map(item => [item.name, item])) }
}

test('drain wakes only this site\'s configured local apps, signed for the Foundation verifier', async (t) => {
  const { config, gateway, platformCalls, upstream } = await gatewayWith(t, ['console', 'workflow', 'aims'])
  await gateway.scheduler.trigger('integration-drain', Date.UTC(2026, 9, 1, 12, 5))
  const snapshot = gateway.scheduler.snapshot()['integration-drain']
  assert.equal(snapshot.lastOk, true)
  assert.equal(snapshot.lastSummary.succeededWakes, 3)
  const wakes = [
    [upstream.console, '/api/internal/integration-operations/drain', 'console'],
    [upstream.workflow, '/workflow/api/internal/integration-operations/drain', 'workflow'],
    [upstream.aims, '/aims/api/internal/integration-operations/drain', 'aims']
  ]
  for (const [app, path, appCode] of wakes) {
    const call = app.calls.find(item => item.url === path)
    assert.ok(call, appCode)
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['x-hzy-scheduler'], 'tenant-gateway')
    assert.equal(call.headers['x-hzy-app-code'], appCode)
    assert.equal(call.headers['x-hzy-deployment'], config.apps[appCode].deploymentCode)
    assert.equal(call.headers['x-hzy-tenant'], config.site.tenantCode)
    assert.equal(call.headers['x-forwarded-host'], config.site.publicHost)
    assert.equal(call.headers['x-hzy-data-runtime-url'], config.runtime.endpoint)
    assert.ok(call.headers['x-hzy-data-runtime-token'])
    const skew = Math.abs(Date.now() - Number(call.headers['x-hzy-scheduler-issued-at']))
    assert.ok(skew < 60_000)
    // Foundation verifies the unprefixed wake path for every app.
    assert.equal(verifySignature(call, config.secrets.gatewayInternalToken, '/api/internal/integration-operations/drain'), true, appCode)
  }
  // Platform is only asked to resolve this host and issue its bootstrap, with the registry token.
  assert.deepEqual([...new Set(platformCalls.map(call => call.path))].sort(), [
    '/api/platform/internal/tenant-gateway/resolve', '/api/platform/internal/tenant-gateway/runtime-bootstrap-token'
  ])
  assert.equal(platformCalls.every(call => call.headers.get('authorization') === `Bearer ${config.secrets.platformRegistryToken}`), true)
  assert.equal(platformCalls.filter(call => call.path.endsWith('/resolve')).every(call => call.query.host === config.site.publicHost), true)
})

test('drain refuses to wake anything when the registry resolves another site\'s deployments', async (t) => {
  const { gateway, upstream } = await gatewayWith(t, ['console', 'workflow'], {
    record: config => registryRecord(config, {
      apps: { console: { deploymentCode: 'managed-cloud-console' }, workflow: { deploymentCode: 'managed-cloud-workflow' } }
    })
  })
  await gateway.scheduler.trigger('integration-drain')
  const snapshot = gateway.scheduler.snapshot()['integration-drain']
  assert.equal(snapshot.lastOk, false)
  assert.equal(snapshot.lastSummary.failedTenants, 1)
  assert.equal(snapshot.lastSummary.attemptedWakes, 0)
  assert.equal(upstream.console.calls.length + upstream.workflow.calls.length, 0)
})

test('policy sync wakes the local Console with a signed scheduler request; readiness reflects failures', async (t) => {
  const { config, gateway, upstream } = await gatewayWith(t, ['console'])
  await gateway.scheduler.trigger('policy-sync')
  const call = upstream.console.calls.find(item => item.url === '/api/internal/policy-bundle/sync')
  assert.ok(call)
  assert.equal(call.headers['x-hzy-deployment'], config.apps.console.deploymentCode)
  assert.equal(verifySignature(call, config.secrets.gatewayInternalToken, '/api/internal/policy-bundle/sync'), true)
  assert.equal(gateway.scheduler.snapshot()['policy-sync'].lastOk, true)

  await upstream.console.close()
  for (let index = 0; index < config.scheduler.alertAfterConsecutiveFailures; index += 1) await gateway.scheduler.trigger('policy-sync')
  assert.equal(gateway.scheduler.snapshot()['policy-sync'].alerting, true)
  const ready = await rawRequest(gateway.healthPort, '/readyz', { headers: new Headers({ host: '127.0.0.1' }) })
  assert.equal(ready.status, 503)
  assert.equal(JSON.parse(ready.body).status, 'degraded')
})
