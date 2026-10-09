import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { createPolicyDelivery, createPolicyWake, startPolicySync, POLICY_URL, POLICY_REVISION_URL, POLICY_EGRESS_PATH, POLICY_REVISION_EGRESS_PATH, POLICY_LIVE_REVISION_EGRESS_PATH, POLICY_SYNC_INTERVAL_MS, POLICY_FULL_REFRESH_MS } from '../policy-sync.mjs'
import { createConsoleEgress } from '../console-egress.mjs'

test('policy delivery pins format, target and transport credential without trusting caller input', async () => {
  const calls = []
  const deliver = createPolicyDelivery({ platformToken: 'platform-fixture', fetchImpl: async (...args) => { calls.push(args); return Response.json({ body: 'signed' }) } })
  await deliver.direct('https://evil.test', { headers: { authorization: 'forged' } })
  const [url, init] = calls[0]
  assert.equal(url, POLICY_URL)
  assert.equal(init.redirect, 'error')
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.authorization, 'Bearer platform-fixture')
  assert.ok(init.signal instanceof AbortSignal)
})

const revisionBody = (revision = 3, status = 'active') => ({ code: 0, data: { policyRevision: revision, payloadHash: `sha256_${revision}`, status } })
const tenantFixture = { tenantCode: 'C000001', environment: 'test', apps: { console: { deploymentCode: 'wiztek-test-console' } }, dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev' } }

test('live revision probe is exact, bounded, isolated from prepared scheduler delivery', async () => {
  const urls = []
  const deliver = createPolicyDelivery({ platformToken: 'platform-fixture', fetchImpl: async (url) => {
    urls.push(url)
    return Response.json(revisionBody())
  } })
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture',
    policyFetch: deliver, workflowLocal: true, fetchImpl: async () => { throw Error('unexpected Console fetch') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = (path, headers = {}) => fetch(base + path, { headers: { 'x-hzy0-egress-token': 'local-fixture', ...headers } })
  try {
    assert.equal((await get(POLICY_LIVE_REVISION_EGRESS_PATH)).status, 200)
    assert.deepEqual(urls, [POLICY_REVISION_URL])
    assert.equal((await get(POLICY_REVISION_EGRESS_PATH)).status, 503, 'scheduler route remains prepared-only')
    for (const path of [`${POLICY_LIVE_REVISION_EGRESS_PATH}?format=envelope`, `${POLICY_LIVE_REVISION_EGRESS_PATH}/more`]) {
      assert.equal((await get(path)).status, 403)
    }
    assert.equal((await get(POLICY_LIVE_REVISION_EGRESS_PATH, { 'x-hzy0-egress-token': 'wrong' })).status, 401)
    assert.deepEqual(urls, [POLICY_REVISION_URL])
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('wake prepares the revision and envelope before a fresh bootstrap; private delivery consumes each once', async () => {
  const order = []
  const deliver = createPolicyDelivery({ platformToken: 'fixture', fetchImpl: async url => {
    order.push(url === POLICY_REVISION_URL ? 'revision' : url === POLICY_URL ? 'envelope' : 'unexpected')
    return url === POLICY_REVISION_URL ? Response.json(revisionBody()) : Response.json({ signed: true })
  } })
  const wake = createPolicyWake({ tenant: tenantFixture, localSecret: 'fixture-key', preparePolicy: deliver.prepare, clearPolicy: deliver.clear,
    facade: { headers: async () => { order.push('bootstrap'); return new Headers({ 'x-hzy-data-runtime-token': 'fixture' }) } },
    fetchImpl: async () => {
      order.push('console')
      assert.deepEqual(await (await deliver('revision')).json(), revisionBody())
      assert.deepEqual(await (await deliver()).json(), { signed: true })
      return Response.json({ code: 0, data: { ready: true, mode: 'renewed' } })
    } })
  const timings = await wake()
  assert.deepEqual(order, ['revision', 'envelope', 'bootstrap', 'console'])
  assert.equal(timings.full, true)
  assert.throws(() => deliver(), /policy_delivery_prepared_unavailable/)
  assert.throws(() => deliver('revision'), /policy_delivery_prepared_unavailable/)
})

test('an unchanged revision skips the full envelope until Console reports renewal is due; a failed wake re-prepares it', async () => {
  let time = 0, revision = 3
  const fetched = []
  const deliver = createPolicyDelivery({ platformToken: 'fixture', now: () => time, fetchImpl: async url => {
    fetched.push(url === POLICY_REVISION_URL ? 'revision' : 'envelope')
    return url === POLICY_REVISION_URL ? Response.json(revisionBody(revision)) : Response.json({ signed: revision })
  } })
  const cycle = async (renewAfter) => {
    fetched.length = 0
    await deliver.prepare()
    deliver.clear()
    if (renewAfter === 'failed') deliver.reset()
    else deliver.confirm(renewAfter)
    return [...fetched]
  }
  const FIFTEEN = 15 * 60000
  assert.deepEqual(await cycle(time + FIFTEEN), ['revision', 'envelope'], 'no confirmed delivery yet')
  time += 60000
  assert.deepEqual(await cycle(FIFTEEN), ['revision'], 'Console confirmed the unchanged revision')
  revision = 4
  assert.deepEqual(await cycle(time + FIFTEEN), ['revision', 'envelope'], 'changed revision fetches the envelope')
  const renewAfter = time + FIFTEEN
  time = renewAfter - POLICY_SYNC_INTERVAL_MS - 1
  assert.deepEqual(await cycle(renewAfter), ['revision'])
  time += 1
  assert.deepEqual(await cycle(time + FIFTEEN), ['revision', 'envelope'], 'renewal due on this or the next wake')
  time += 60000
  assert.deepEqual(await cycle('failed'), ['revision'])
  assert.deepEqual(await cycle(time + FIFTEEN), ['revision', 'envelope'], 'a failed wake is never counted as delivered')
  time += 60000
  assert.deepEqual(await cycle(undefined), ['revision'], 'missing renewAfter falls back to the fixed interval')
  time += POLICY_FULL_REFRESH_MS
  assert.deepEqual(await cycle(undefined), ['revision', 'envelope'])
})

test('wake confirms only a successful Console sync and reports its mode', async () => {
  const confirmed = []
  const wake = createPolicyWake({ tenant: tenantFixture, localSecret: 'fixture-key', confirmPolicy: value => confirmed.push(value),
    facade: { headers: async () => new Headers({ 'x-hzy-data-runtime-token': 'fixture' }) },
    fetchImpl: async () => Response.json({ code: 0, data: { ready: true, mode: 'unchanged', renewAfter: 123 } }) })
  assert.equal((await wake()).mode, 'unchanged')
  assert.deepEqual(confirmed, [123])
  const failing = createPolicyWake({ tenant: tenantFixture, localSecret: 'fixture-key', confirmPolicy: value => confirmed.push(value),
    facade: { headers: async () => new Headers({ 'x-hzy-data-runtime-token': 'fixture' }) },
    fetchImpl: async () => Response.json({ code: 0, data: { ready: false, renewAfter: 456 } }) })
  await assert.rejects(failing)
  assert.deepEqual(confirmed, [123])
})

test('Platform refusals and outages are prepared as outcomes, bounded, and never fetched again on delivery', async () => {
  let reply = url => url === POLICY_REVISION_URL ? Response.json(revisionBody()) : Response.json({ signed: true })
  let calls = 0, time = 0
  const deliver = createPolicyDelivery({ platformToken: 'fixture', now: () => time, prepareTimeoutMs: 20, fetchImpl: async url => { calls++; return reply(url) } })
  for (const [name, respond, revisionStatus, envelopeStatus] of [
    ['refused', () => Response.json({ data: { code: 'policy_deployment_inactive' } }, { status: 403 }), 403, 403],
    ['outage', () => { throw Error('connect ETIMEDOUT secret') }, 503, 503],
    ['rate limited', () => Response.json({}, { status: 429 }), 429, 429],
    ['oversized', url => url === POLICY_REVISION_URL ? Response.json(revisionBody()) : new Response('x'.repeat((8 << 20) + 2049), { headers: { 'content-type': 'application/json' } }), 200, 503],
    ['stalled', url => url === POLICY_REVISION_URL ? Response.json(revisionBody(9)) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([123])) } }), { headers: { 'content-type': 'application/json' } }), 200, 503],
    ['html', () => new Response('<html>secret</html>'), 503, 503]
  ]) {
    reply = respond
    deliver.reset()
    const outcome = await deliver.prepare()
    assert.equal(outcome.revisionStatus, revisionStatus, name)
    assert.equal(outcome.envelopeStatus, envelopeStatus, name)
    const before = calls
    assert.equal((await deliver()).status, envelopeStatus, name)
    assert.equal(calls, before, `${name}: delivery never refetches`)
    assert.throws(() => deliver(), /policy_delivery_prepared_unavailable/)
  }
  reply = url => url === POLICY_REVISION_URL ? Response.json(revisionBody()) : Response.json({ signed: true })
  await deliver.prepare()
  time += 30001
  assert.throws(() => deliver(), /policy_delivery_prepared_unavailable/, 'expired prepared outcome cannot trigger a fetch')
})

test('a failed Platform fetch still wakes Console so it records its renewal state', async () => {
  const deliver = createPolicyDelivery({ platformToken: 'fixture', fetchImpl: async () => { throw Error('offline') } })
  let consoleCalls = 0
  const wake = createPolicyWake({ tenant: tenantFixture, localSecret: 'fixture-key', preparePolicy: deliver.prepare, clearPolicy: deliver.clear, resetPolicy: deliver.reset,
    facade: { headers: async () => new Headers({ 'x-hzy-data-runtime-token': 'fixture' }) },
    fetchImpl: async () => {
      consoleCalls++
      assert.equal((await deliver('revision')).status, 503)
      assert.equal((await deliver()).status, 503)
      return Response.json({ statusCode: 503, data: { code: 'policy_sync_platform_unavailable' } }, { status: 503 })
    } })
  await assert.rejects(wake, error => error.stage === 'console-response' && error.status === 503 && error.timings.envelopeStatus === 503)
  assert.equal(consoleCalls, 1)
})

test('private delivery requires local credential, passes only refusal codes, and bounds payloads', async () => {
  let reply = () => Response.json({ body: 'unchanged', signature: 'fixture' }, { headers: { 'x-secret': 'secret', 'set-cookie': 'secret=1' } })
  const kinds = []
  const server = createConsoleEgress({ localSecret: 'local', remoteSecret: 'remote', policyFetch: kind => { kinds.push(kind); return reply() } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (path = POLICY_EGRESS_PATH, options = {}) => fetch(base + path, { headers: { 'x-hzy0-egress-token': 'local' }, ...options })
  try {
    assert.equal((await request(undefined, { headers: {} })).status, 401)
    for (const path of [POLICY_EGRESS_PATH + '?target=evil', POLICY_EGRESS_PATH + '/extra', POLICY_REVISION_EGRESS_PATH + '?x=1']) assert.equal((await request(path)).status, 403)
    assert.equal((await request(undefined, { method: 'POST', body: '{}' })).status, 403)
    assert.equal(kinds.length, 0)
    const response = await request()
    assert.deepEqual(await response.json(), { body: 'unchanged', signature: 'fixture' })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.has('set-cookie'), false)
    assert.equal(response.headers.has('x-secret'), false)
    await request(POLICY_REVISION_EGRESS_PATH)
    assert.deepEqual(kinds, ['envelope', 'revision'])
    for (const [status, code] of [[401, 'policy_envelope_current_missing'], [403, 'policy_deployment_inactive'], [409, 'Not A Code secret']]) {
      reply = () => Response.json({ data: { code }, secret: 'secret' }, { status })
      const refusal = await request()
      const text = await refusal.text()
      assert.equal(refusal.status, status)
      assert.doesNotMatch(text, /secret/)
      assert.equal(JSON.parse(text).code, /^[a-z][a-z0-9_]*$/.test(code) ? code : 'hzy0_platform_policy_refused')
    }
    for (const status of [408, 429, 500, 503]) {
      reply = () => Response.json({ secret: 'secret' }, { status })
      const error = await request(); assert.equal(error.status, 503); assert.doesNotMatch(await error.text(), /secret/)
    }
    reply = () => new Response('<html>secret</html>')
    assert.equal((await request()).status, 503)
    reply = () => new Response('x'.repeat((8 << 20) + 2049), { headers: { 'content-type': 'application/json' } })
    assert.equal((await request()).status, 502)
    reply = () => { throw Error('credential-secret') }
    const failure = await request(); assert.equal(failure.status, 502); assert.doesNotMatch(await failure.text(), /credential-secret/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('wake uses formal signed Console scheduler context and bounded direct loopback transport', async () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { console: { deploymentCode: 'wiztek-test-console' } }, dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev' } }
  let call
  const wake = createPolicyWake({ tenant, localSecret: 'fixture-key', facade: { headers: async () => new Headers({ 'x-hzy-data-runtime-token': 'bootstrap-fixture' }) },
    fetchImpl: async (url, init) => { call = { url, init }; return Response.json({ code: 0, data: { ready: true } }) } })
  await wake()
  const h = call.init.headers
  assert.equal(call.url, 'http://127.0.0.1:23100/console/api/internal/policy-bundle/sync')
  assert.equal(call.init.redirect, 'error')
  assert.equal(h.get('x-hzy-app-code'), 'console')
  assert.equal(h.get('x-hzy-deployment'), 'wiztek-test-console')
  assert.equal(h.get('x-hzy-data-runtime-token'), 'bootstrap-fixture')
  const canonical = ['POST', '/api/internal/policy-bundle/sync', h.get('x-request-id'), 'C000001', 'wiztek-test-console', 'console', 'test', tenant.dataRuntime.endpoint, 'hzy0.isme.dev', h.get('x-hzy-scheduler-issued-at')].join('\n')
  assert.equal(h.get('x-hzy-scheduler-signature'), createHmac('sha256', 'fixture-key').update(canonical).digest('hex'))
})

test('loopback dial header does not alter signed canonical scheduler binding', async () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { console: { deploymentCode: 'wiztek-test-console' } },
    dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev' } }
  let headers
  await createPolicyWake({ tenant, localSecret: 'fixture-key', facade: { headers: async () => new Headers({
    'x-hzy-data-runtime-token': 'bootstrap-fixture', 'x-hzy-local-runtime-dial-url': 'http://127.0.0.1:18084'
  }) }, fetchImpl: async (_url, init) => { headers = init.headers; return Response.json({ code: 0, data: { ready: true } }) } })()
  assert.equal(headers.get('x-hzy-data-runtime-url'), tenant.dataRuntime.endpoint)
  assert.equal(headers.get('x-hzy-local-runtime-dial-url'), 'http://127.0.0.1:18084')
  const canonical = ['POST', '/api/internal/policy-bundle/sync', headers.get('x-request-id'), 'C000001',
    'wiztek-test-console', 'console', 'test', tenant.dataRuntime.endpoint, 'hzy0.isme.dev',
    headers.get('x-hzy-scheduler-issued-at')].join('\n')
  assert.equal(headers.get('x-hzy-scheduler-signature'), createHmac('sha256', 'fixture-key').update(canonical).digest('hex'))
})

test('sync does not overlap, retry failures renew no timestamps, and stop cancels future wakes', async () => {
  let finish, next, calls = 0, cancelled
  const reports = []
  const stop = startPolicySync(() => { calls++; return new Promise(resolve => { finish = resolve }) }, {
    schedule: (run, ms) => { assert.equal(ms, POLICY_SYNC_INTERVAL_MS); next = run; return 7 }, cancel: id => { cancelled = id }, report: value => reports.push(value)
  })
  assert.equal(calls, 1); assert.equal(next, undefined)
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(reports[0].event, 'hzy0-policy-sync')
  assert.equal(reports[0].ready, true)
  assert.ok(reports[0].elapsedMs >= 0)
  stop(); assert.equal(cancelled, 7)
  let scheduled = false
  const stopPending = startPolicySync(() => new Promise((_, reject) => { finish = reject }), { schedule: () => { scheduled = true }, report: value => reports.push(value) })
  stopPending(); finish(Error('private details')); await new Promise(resolve => setImmediate(resolve))
  assert.equal(scheduled, false)
  assert.equal(reports.at(-1).ready, false)
  assert.equal(reports.at(-1).stage, 'unknown')
  assert.ok(reports.at(-1).elapsedMs >= 0)
})

test('wake reports only a bounded failure stage, never upstream details', async () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { console: { deploymentCode: 'wiztek-test-console' } }, dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev' } }
  for (const [expectedStage, facade, fetchImpl] of [
    ['policy-delivery', { headers: async () => { throw Error('bootstrap-must-not-run') } }, async () => { throw Error('unexpected') }],
    ['bootstrap', { headers: async () => { throw Error('secret-bootstrap') } }, async () => { throw Error('unexpected') }],
    ['console-fetch', { headers: async () => new Headers({ 'x-hzy-data-runtime-token': 'fixture' }) }, async () => { throw Error('secret-fetch') }],
    ['console-response', { headers: async () => new Headers({ 'x-hzy-data-runtime-token': 'fixture' }) }, async () => Response.json({ secret: 'secret-response' }, { status: 503 })]
  ]) {
    const wake = createPolicyWake({ tenant, localSecret: 'fixture-key', facade, fetchImpl,
      ...(expectedStage === 'policy-delivery' ? { preparePolicy: async () => { throw Error('secret-policy') } } : {}) })
    await assert.rejects(wake, error => error.stage === expectedStage
      && (expectedStage !== 'console-response' || error.status === 503)
      && !JSON.stringify(error).includes('secret'))
  }
})

test('failed wakes back off within the signed window and success restores normal cadence', async () => {
  let next, failures = 4, calls = 0
  const delays = []
  const stop = startPolicySync(async () => { calls++; if (failures-- > 0) throw Error('transport unavailable') }, {
    schedule: (run, ms) => { next = run; delays.push(ms); return 1 }, cancel: () => {}, report: () => {}
  })
  await new Promise(resolve => setImmediate(resolve))
  for (let i = 0; i < 4; i++) await next()
  assert.deepEqual(delays, [15000, 30000, 60000, 60000, POLICY_SYNC_INTERVAL_MS])
  stop()
  await next()
  assert.equal(calls, 5, 'already queued callbacks cannot wake after shutdown')
})

test('with the revision probe disabled no probe reaches Platform and every wake prepares the envelope', async () => {
  const fetched = []
  const deliver = createPolicyDelivery({ platformToken: 'fixture', revisionProbe: false, fetchImpl: async url => { fetched.push(url); return Response.json({ signed: true }) } })
  for (let i = 0; i < 2; i++) {
    const outcome = await deliver.prepare()
    assert.deepEqual(outcome, { full: true, revisionStatus: 503, envelopeStatus: 200 })
    assert.equal((await deliver('revision')).status, 503)
    await deliver()
    deliver.clear()
  }
  assert.deepEqual(fetched, [POLICY_URL, POLICY_URL])
  const gateway = (await import('node:fs')).readFileSync(new URL('../gateway.mjs', import.meta.url), 'utf8')
  assert.match(gateway, /revisionProbe: process\.env\.HZY0_POLICY_REVISION_PROBE === 'true'/)
  const runner = (await import('node:fs')).readFileSync(new URL('../run-process.mjs', import.meta.url), 'utf8')
  assert.match(runner, /env: \{ \.\.\.processEnvironment\(profile\),[^}]*\bHZY0_POLICY_REVISION_PROBE: 'true'[^}]*\}/)
})

test('acceptance fault switch simulates outage and refusal without contacting Platform', async () => {
  let fault = null, calls = 0
  const deliver = createPolicyDelivery({ platformToken: 'fixture', fault: () => fault, fetchImpl: async url => {
    calls++
    return url === POLICY_REVISION_URL ? Response.json(revisionBody()) : Response.json({ signed: true })
  } })
  fault = 'unavailable'
  assert.deepEqual(await deliver.prepare(), { full: true, revisionStatus: 503, envelopeStatus: 503, simulatedFault: 'unavailable' })
  assert.equal((await deliver()).status, 503)
  fault = 'refused'
  assert.deepEqual(await deliver.prepare(), { full: true, revisionStatus: 403, envelopeStatus: 403, simulatedFault: 'refused' })
  assert.deepEqual(await (await deliver()).json(), { data: { code: 'hzy0_simulated_policy_refusal' } })
  assert.equal(calls, 0)
  fault = null
  assert.deepEqual(await deliver.prepare(), { full: true, revisionStatus: 200, envelopeStatus: 200 })
  assert.equal(calls, 2)
  const gateway = (await import('node:fs')).readFileSync(new URL('../gateway.mjs', import.meta.url), 'utf8')
  assert.match(gateway, /resolve\(dirname\(values\.profile\), 'policy-sync-fault'\)/)
})
