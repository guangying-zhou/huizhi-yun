import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { configFor, startGateway, startUpstream } from './fixtures.mjs'

// An upstream that answers before it has read the request body (login redirects, 4xx/5xx) cancels the Web request stream while
// the Node side is still delivering data. That must never take the Gateway process down.
async function earlyUpstream(name, status) {
  const server = createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'text/plain', connection: 'close' })
    res.end('early')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { name, origin: `http://127.0.0.1:${server.address().port}`, calls: [], server, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }) }
}

// Reads request bodies like a real app and records completed ones; tolerates client/gateway aborts.
async function tolerantUpstream(name) {
  const calls = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('error', () => {})
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => { calls.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { name, origin: `http://127.0.0.1:${server.address().port}`, calls, server, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }) }
}

function postLarge(port, host, path, megabytes, { abortAfterMs } = {}) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers: { host, 'content-type': 'application/octet-stream' } }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode }))
      res.on('error', () => resolve({ status: 0 }))
    })
    req.on('error', () => resolve({ status: 0 }))
    req.on('close', () => resolve({ status: 0 }))
    const chunk = Buffer.alloc(64 * 1024, 97)
    let sent = 0
    const total = megabytes * 16
    const pump = () => {
      while (sent < total) {
        sent += 1
        if (!req.write(chunk)) return req.once('drain', pump)
      }
      req.end()
    }
    pump()
    if (abortAfterMs) setTimeout(() => req.destroy(), abortAfterMs)
  })
}

for (const status of [302, 503]) {
  test(`upstream answering ${status} before reading a large request body does not crash the Gateway`, async (t) => {
    const errors = []
    const onUncaught = error => errors.push(error)
    process.on('uncaughtException', onUncaught)
    const early = await earlyUpstream('workflow', status)
    const other = await startUpstream('console')
    const config = configFor([other, early])
    const gateway = await startGateway(config)
    t.after(async () => {
      process.off('uncaughtException', onUncaught)
      await gateway.close(); await early.close(); await other.close()
    })
    for (let round = 0; round < 3; round += 1) {
      const result = await postLarge(gateway.port, config.site.publicHost, '/workflow/api/login', 8)
      assert.ok(result.status !== undefined)
      assert.ok([status, 413, 502, 0].includes(result.status), `unexpected ${result.status}`)
    }
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.deepEqual(errors.map(error => error.message), [], 'no uncaught exception')
    const health = await gateway.request('/workflow/api/ping')
    assert.equal(health.status, status, 'the Gateway still answers after the early responses')
  })
}

test('a client that aborts mid-upload does not crash the Gateway', async (t) => {
  const errors = []
  const onUncaught = error => errors.push(error)
  process.on('uncaughtException', onUncaught)
  const slow = await tolerantUpstream('workflow')
  const console_ = await startUpstream('console')
  const config = configFor([console_, slow])
  const gateway = await startGateway(config)
  t.after(async () => { process.off('uncaughtException', onUncaught); await gateway.close(); await slow.close(); await console_.close() })
  await postLarge(gateway.port, config.site.publicHost, '/workflow/api/upload', 32, { abortAfterMs: 20 })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(errors.map(error => error.message), [])
  assert.equal((await gateway.request('/workflow/api/ping')).status, 200)
})

test('small request bodies answered early by the upstream (sendBeacon-style POSTs) never produce uncaught exceptions', async (t) => {
  const errors = []
  const onUncaught = error => errors.push(error.message)
  process.on('uncaughtException', onUncaught)
  const early = await earlyUpstream('console', 404)
  const other = await startUpstream('workflow')
  const config = configFor([early, other])
  const gateway = await startGateway(config)
  t.after(async () => { process.off('uncaughtException', onUncaught); await gateway.close(); await early.close(); await other.close() })
  const { request } = await import('node:http')
  const post = size => new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: gateway.port, method: 'POST', path: '/api/rum', headers: { host: config.site.publicHost, 'content-type': 'text/plain', 'content-length': size } },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', () => resolve(0))
    req.end(Buffer.alloc(size, 97))
  })
  const statuses = new Set()
  for (let i = 0; i < 150; i += 1) statuses.add(await post(120 + (i % 5) * 300))
  await Promise.all(Array.from({ length: 50 }, () => post(200)))
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(errors, [])
  assert.deepEqual([...statuses], [404])
})

test('bodies above limits.maxRequestBodyBytes still get 413, counted over every byte, and the body is forwarded intact below it', async (t) => {
  const upstream = await tolerantUpstream('workflow')
  const consoleUp = await startUpstream('console')
  const config = configFor([consoleUp, upstream], { overrides: { limits: { maxRequestBodyBytes: 1024 * 1024 } } })
  const limit = config.limits.maxRequestBodyBytes
  assert.equal(limit, 1024 * 1024)
  const gateway = await startGateway(config)
  t.after(async () => { await gateway.close(); await upstream.close(); await consoleUp.close() })
  const small = await gateway.request('/workflow/api/echo', { method: 'POST', headers: new Headers({ 'content-type': 'text/plain' }), body: 'hello-body' })
  assert.equal(small.status, 200)
  assert.equal(upstream.calls.at(-1).body, 'hello-body')
  const over = await postLarge(gateway.port, config.site.publicHost, '/workflow/api/big', 4)
  assert.ok([413, 0].includes(over.status), `over-limit upload answered ${over.status}`)
  const exact = await gateway.request('/workflow/api/exact', { method: 'POST', headers: new Headers({ 'content-type': 'text/plain' }), body: 'x'.repeat(limit) })
  assert.equal(exact.status, 200, 'a body of exactly the limit is accepted')
  const oneOver = await gateway.request('/workflow/api/one-over', { method: 'POST', headers: new Headers({ 'content-type': 'text/plain' }), body: 'x'.repeat(limit + 1) }).catch(() => ({ status: 0 }))
  assert.ok([413, 0].includes(oneOver.status), `limit+1 answered ${oneOver.status}`)
  assert.equal(upstream.calls.filter(call => call.url === '/workflow/api/one-over').length, 0)
  const bodiesSeen = upstream.calls.filter(call => call.url === '/workflow/api/big').length
  assert.equal(bodiesSeen, 0, 'an over-limit body is never completed upstream')
  assert.equal((await gateway.request('/workflow/api/ping')).status, 200, 'the Gateway keeps serving')
})
