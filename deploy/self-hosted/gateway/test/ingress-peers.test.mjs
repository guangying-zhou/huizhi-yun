// Tailnet ingress mode (nginx → Tailscale → gateway). Tests never bind a real
// Tailscale address: the gateway listens on loopback (a peer that the tailnet
// allowlist must refuse), and allowlisted peers are simulated by injecting a
// real accepted socket whose remoteAddress is set, exactly as a tailnet
// connection would arrive.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { connect, createServer as createNetServer } from 'node:net'
import test from 'node:test'
import { ConfigError, validateConfig } from '../config.mjs'
import {
  auditClientAddress, createPeerGuard, isTailnetAddress, listenWithRetry, normalizePeerAddress
} from '../ingress-peers.mjs'
import { createGatewayHost } from '../server.mjs'
import { configFor, platformMock, rawConfig, rawRequest, startGateway, startUpstream } from './fixtures.mjs'

const LISTEN = '100.64.72.59'
const NGINX = '100.98.120.65'

function tailnetListeners(overrides = {}) {
  return {
    ingress: { host: LISTEN, port: 18780, allowedPeers: [NGINX], ...overrides },
    health: { host: '127.0.0.1', port: 18781 }
  }
}

function rejectsWith(raw, pattern) {
  assert.throws(() => validateConfig(raw), (error) => {
    assert.ok(error instanceof ConfigError)
    assert.ok(error.issues.some(issue => pattern.test(issue)), `${pattern} not in ${error.issues.join(' | ')}`)
    // Issue texts never echo configured addresses (only the fixed rule texts).
    for (const issue of error.issues) {
      assert.doesNotMatch(issue.replaceAll('127.0.0.1', '').replaceAll('100.64.0.0/10', ''), /\d+\.\d+\.\d+\.\d+/)
    }
    return true
  }, String(pattern))
}

test('loopback default is unchanged: mode loopback, no peers, served over loopback', async (t) => {
  const config = validateConfig(rawConfig())
  assert.deepEqual({ ...config.listeners.ingress }, { host: '127.0.0.1', port: 18780, mode: 'loopback', allowedPeers: [] })
  assert.deepEqual({ ...config.listeners.health }, { host: '127.0.0.1', port: 18781 })
  const ipv6 = rawConfig()
  ipv6.listeners.ingress.host = '::1'
  assert.equal(validateConfig(ipv6).listeners.ingress.mode, 'loopback')

  const consoleUpstream = await startUpstream('console')
  const gateway = await startGateway(configFor([consoleUpstream]))
  t.after(async () => { await gateway.close(); await consoleUpstream.close() })
  const response = await gateway.request('/api/v1/console/auth/me')
  assert.equal(response.status, 200)
  const health = JSON.parse((await rawRequest(gateway.healthPort, '/healthz', { headers: new Headers({ host: '127.0.0.1' }) })).body)
  assert.deepEqual(health.ingress, { mode: 'loopback', allowedPeerCount: 0, peerRefusals: 0 })
})

test('a single Tailscale bind address with explicit peers is accepted', () => {
  const raw = rawConfig({ overrides: { listeners: tailnetListeners({ allowedPeers: [NGINX, '100.127.0.9'] }) } })
  const { ingress, health } = validateConfig(raw).listeners
  assert.equal(ingress.host, LISTEN)
  assert.equal(ingress.mode, 'tailnet')
  assert.deepEqual([...ingress.allowedPeers], [NGINX, '100.127.0.9'])
  assert.ok(Object.isFrozen(ingress.allowedPeers))
  assert.equal(health.host, '127.0.0.1')
})

test('invalid ingress bind hosts are rejected', () => {
  for (const host of ['0.0.0.0', '::', '::ffff:100.64.72.59', '192.168.1.10', '10.0.0.5', '172.16.0.1', '203.0.113.7',
    '8.8.8.8', '100.63.255.255', '100.128.0.1', '100.64.0.0', '100.127.255.255', '100.100.100.100', '100.064.72.59',
    '100.64.72', 'localhost', 'gateway.tailnet.ts.net', 'fd7a:115c:a1e0::1', '100.64.72.59 ', '', 42, null]) {
    rejectsWith(rawConfig({ overrides: { listeners: tailnetListeners({ host }) } }), /listeners\.ingress\.host must be/)
  }
})

test('health stays loopback-only even when ingress uses Tailscale', () => {
  const listeners = tailnetListeners()
  listeners.health.host = '100.64.72.60'
  rejectsWith(rawConfig({ overrides: { listeners } }), /listeners\.health\.host must be 127\.0\.0\.1 or ::1/)
  const withPeers = tailnetListeners()
  withPeers.health.allowedPeers = [NGINX]
  rejectsWith(rawConfig({ overrides: { listeners: withPeers } }), /listeners\.health\.allowedPeers is not allowed/)
})

test('allowedPeers is required for a Tailscale bind and validated strictly', () => {
  const cases = [
    [undefined, /allowedPeers must list 1-16/],
    [[], /allowedPeers must list 1-16/],
    [NGINX, /allowedPeers must list 1-16/],
    [Array.from({ length: 17 }, (_, index) => `100.98.120.${index + 1}`), /allowedPeers must list 1-16/],
    [['0.0.0.0'], /allowedPeers\[0\] must be one Tailscale/],
    [['192.168.1.2'], /allowedPeers\[0\] must be one Tailscale/],
    [['100.98.120.0/24'], /allowedPeers\[0\] must be one Tailscale/],
    [[NGINX, '::ffff:100.98.120.66'], /allowedPeers\[1\] must be one Tailscale/],
    [['gitlab.wiztek.cn'], /allowedPeers\[0\] must be one Tailscale/],
    [[NGINX, NGINX], /allowedPeers\[1\] is a duplicate/],
    [[LISTEN], /allowedPeers\[0\] must not be the listener address/]
  ]
  for (const [allowedPeers, pattern] of cases) {
    rejectsWith(rawConfig({ overrides: { listeners: tailnetListeners({ allowedPeers }) } }), pattern)
  }
  // Peers only make sense with a Tailscale bind.
  const loopback = rawConfig()
  loopback.listeners.ingress.allowedPeers = [NGINX]
  rejectsWith(loopback, /allowedPeers is only allowed with a Tailscale listener host/)
})

test('peer address normalization handles IPv4-mapped IPv6 and junk', () => {
  assert.equal(normalizePeerAddress(`::ffff:${NGINX}`), NGINX)
  assert.equal(normalizePeerAddress(`::FFFF:${NGINX}`), NGINX)
  assert.equal(normalizePeerAddress(NGINX), NGINX)
  assert.equal(normalizePeerAddress('::1'), '::1')
  assert.equal(normalizePeerAddress('not-an-ip'), '')
  assert.equal(normalizePeerAddress(undefined), '')
  assert.equal(isTailnetAddress('100.64.0.1'), true)
  assert.equal(isTailnetAddress('100.127.255.254'), true)
  const guard = createPeerGuard({ mode: 'tailnet', allowedPeers: [NGINX] })
  assert.equal(guard.allows(`::ffff:${NGINX}`), true)
  assert.equal(guard.allows('::ffff:100.98.120.66'), false)
  assert.equal(guard.allows('127.0.0.1'), false)
  assert.equal(guard.allows(undefined), false)
  const loopback = createPeerGuard({ mode: 'loopback' })
  assert.equal(loopback.allows('::ffff:127.0.0.1'), true)
  assert.equal(loopback.allows(NGINX), false)
})

// --- live tailnet-mode host bound to loopback -------------------------------

async function startCollab() {
  const upgrades = []
  const server = createServer((req, res) => { res.writeHead(426); res.end() })
  server.on('upgrade', (req, socket) => {
    upgrades.push({ url: req.url, headers: req.headers })
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.on('end', () => socket.destroy())
    socket.on('error', () => socket.destroy())
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { name: 'collab', origin: `http://127.0.0.1:${server.address().port}`, upgrades, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }) }
}

async function setupTailnet(t) {
  const consoleUpstream = await startUpstream('console')
  const collab = await startCollab()
  const config = configFor([consoleUpstream, collab], { overrides: { listeners: tailnetListeners() } })
  assert.equal(config.listeners.ingress.mode, 'tailnet')
  const logs = []
  const { baseFetch } = platformMock(config)
  const host = createGatewayHost(config, { baseFetch, log: (event, fields) => logs.push({ event, fields }) })
  const previousFetch = globalThis.fetch
  globalThis.fetch = host.egressFetch
  // Loopback stands in for the tailnet bind; 127.0.0.1 is NOT an allowed peer.
  await new Promise(resolve => host.ingress.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => host.health.listen(0, '127.0.0.1', resolve))

  // Relay whose accepted sockets are handed to the ingress server as if they
  // came from `peerAddress` over the tailnet.
  let peerAddress = NGINX
  const relay = createNetServer((socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: peerAddress, configurable: true })
    host.ingress.emit('connection', socket)
  })
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await host.scheduler.stop()
    host.ingress.closeAllConnections?.()
    await new Promise(resolve => relay.close(resolve))
    await new Promise(resolve => host.ingress.close(resolve))
    await new Promise(resolve => host.health.close(resolve))
    globalThis.fetch = previousFetch
    await consoleUpstream.close()
    await collab.close()
  })
  return {
    config,
    host,
    logs,
    consoleUpstream,
    collab,
    directPort: host.ingress.address().port,
    relayPort: relay.address().port,
    setPeer(value) { peerAddress = value },
    async health() {
      return JSON.parse((await rawRequest(host.health.address().port, '/healthz', { headers: new Headers({ host: '127.0.0.1' }) })).body)
    }
  }
}

/** Send raw bytes; resolve with everything received until the socket closes. */
function exchange(port, payload, { untilHeaders = false } = {}) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    let received = ''
    let settled = false
    const done = (reason) => {
      if (settled) return
      settled = true
      resolve({ received, reason, socket })
    }
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1')
      if (untilHeaders && received.includes('\r\n\r\n')) done('headers')
    })
    socket.on('error', () => done('error'))
    socket.on('close', () => done('close'))
    socket.write(payload)
  })
}

function httpPayload(host, path = '/api/v1/console/auth/me', extra = {}) {
  const lines = [`GET ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: close',
    ...Object.entries(extra).map(([name, value]) => `${name}: ${value}`)]
  return `${lines.join('\r\n')}\r\n\r\n`
}

function upgradePayload(host) {
  return [`GET /codocs/ws HTTP/1.1`, `Host: ${host}`, 'Connection: Upgrade', 'Upgrade: websocket',
    'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', `Origin: https://${host}`, '', ''].join('\r\n')
}

test('non-allowlisted peers are destroyed with no response for HTTP and WebSocket upgrades', async (t) => {
  const ctx = await setupTailnet(t)
  const { publicHost } = ctx.config.site
  const http = await exchange(ctx.directPort, httpPayload(publicHost))
  assert.equal(http.received, '', 'no response bytes for a refused HTTP peer')
  const ws = await exchange(ctx.directPort, upgradePayload(publicHost))
  assert.equal(ws.received, '', 'no response bytes for a refused upgrade')
  ctx.setPeer('100.98.120.66')
  const spoofed = await exchange(ctx.relayPort, httpPayload(publicHost))
  assert.equal(spoofed.received, '')
  ctx.setPeer('::ffff:100.98.120.66')
  const mapped = await exchange(ctx.relayPort, upgradePayload(publicHost))
  assert.equal(mapped.received, '')

  assert.equal(ctx.consoleUpstream.calls.length, 0)
  assert.equal(ctx.collab.upgrades.length, 0)
  const health = await ctx.health()
  assert.deepEqual(health.ingress, { mode: 'tailnet', allowedPeerCount: 1, peerRefusals: 4 })
  // Refusals are logged (throttled) without any address.
  const refusalLogs = ctx.logs.filter(entry => entry.event === 'gateway-ingress-peer-refused')
  assert.equal(refusalLogs.length, 1)
  assert.doesNotMatch(JSON.stringify(ctx.logs), /\d+\.\d+\.\d+\.\d+|::ffff/)
})

test('allowlisted peer (plain or IPv4-mapped) is served; Host check still applies', async (t) => {
  const ctx = await setupTailnet(t)
  const { publicHost } = ctx.config.site
  for (const peer of [NGINX, `::ffff:${NGINX}`]) {
    ctx.setPeer(peer)
    const ok = await exchange(ctx.relayPort, httpPayload(publicHost))
    assert.match(ok.received, /^HTTP\/1\.1 200 /, peer)
  }
  const wrongHost = await exchange(ctx.relayPort, httpPayload('gitlab.wiztek.cn'))
  assert.match(wrongHost.received, /^HTTP\/1\.1 421 /)
  assert.equal(ctx.consoleUpstream.calls.length, 2)

  const ws = await exchange(ctx.relayPort, upgradePayload(publicHost), { untilHeaders: true })
  ws.socket.destroy()
  assert.match(ws.received, /^HTTP\/1\.1 101 /)
  assert.equal(ctx.collab.upgrades.length, 1)
  assert.equal(ctx.collab.upgrades[0].headers['x-forwarded-for'], undefined)
  assert.equal((await ctx.health()).ingress.peerRefusals, 0)
})

test('forwarding and client-address claims are never trusted; the audit address comes only from the allowlisted peer', async (t) => {
  const ctx = await setupTailnet(t)
  const { publicHost } = ctx.config.site
  const forged = {
    'X-Forwarded-For': '127.0.0.1',
    'X-Forwarded-Host': 'evil.example.test',
    'X-Forwarded-Proto': 'http',
    Forwarded: 'for=127.0.0.1;host=evil.example.test',
    'CF-Connecting-IP': '127.0.0.1',
    'True-Client-IP': '127.0.0.1',
    'X-Client-IP': '127.0.0.1',
    'x-hzy-gateway-token': 'forged',
    'x-hzy-tenant': 'OTHER',
    'x-hzy-gateway': 'forged',
    'x-hzy-actor-uid': 'admin',
    'x-hzy-app-code': 'finance',
    'x-hzy-deployment': 'forged-deployment',
    'x-forwarded-prefix': '/evil-prefix'
  }
  const cases = [
    [{ 'X-Real-IP': '203.0.113.9' }, '203.0.113.9'],
    [{ 'X-Real-IP': '2001:db8::7' }, '2001:db8::7'],
    [{}, NGINX],
    [{ 'X-Real-IP': '127.0.0.1' }, NGINX],
    [{ 'X-Real-IP': '::ffff:127.0.0.1' }, NGINX],
    [{ 'X-Real-IP': '0.0.0.0' }, NGINX],
    [{ 'X-Real-IP': '203.0.113.9, 127.0.0.1' }, NGINX],
    [{ 'X-Real-IP': 'attacker' }, NGINX]
  ]
  for (const [extra, expected] of cases) {
    const result = await exchange(ctx.relayPort, httpPayload(publicHost, '/api/v1/console/auth/me', { ...forged, ...extra }))
    assert.match(result.received, /^HTTP\/1\.1 200 /)
    const h = ctx.consoleUpstream.calls.at(-1).headers
    assert.equal(h['x-forwarded-for'], expected, JSON.stringify(extra))
    assert.equal(h['x-real-ip'], expected)
    assert.equal(h['x-forwarded-host'], publicHost)
    assert.equal(h['x-forwarded-proto'], 'https')
    assert.equal(h.forwarded, undefined)
    assert.equal(h['cf-connecting-ip'], undefined)
    assert.equal(h['true-client-ip'], undefined)
    assert.equal(h['x-client-ip'], undefined)
    assert.equal(h['x-hzy-tenant'], ctx.config.site.tenantCode)
    assert.equal(h['x-hzy-gateway-token'], ctx.config.secrets.gatewayInternalToken)
    assert.equal(h['x-hzy-gateway'], 'tenant-gateway')
    assert.equal(h['x-hzy-actor-uid'], undefined)
    assert.equal(h['x-hzy-app-code'], 'console')
    assert.notEqual(h['x-hzy-deployment'], 'forged-deployment')
    assert.notEqual(h['x-forwarded-prefix'], '/evil-prefix')
  }
  // Defence in depth: the helper refuses to derive anything for a foreign peer.
  const guard = createPeerGuard({ mode: 'tailnet', allowedPeers: [NGINX] })
  assert.equal(auditClientAddress({ socket: { remoteAddress: '100.98.120.66' }, headers: { 'x-real-ip': '203.0.113.9' } }, guard), null)
})

test('tailnet bind retries EADDRNOTAVAIL with capped backoff; other errors and loopback fail fast', async () => {
  function fakeServer(failures) {
    const server = new EventEmitter()
    server.attempts = 0
    server.listen = (options) => {
      server.attempts += 1
      server.options = options
      const failure = failures[server.attempts - 1]
      if (failure) queueMicrotask(() => server.emit('error', Object.assign(new Error('bind failed'), { code: failure })))
      else queueMicrotask(() => server.emit('listening'))
    }
    return server
  }
  const delays = []
  const logs = []
  const sleep = async (ms) => { delays.push(ms) }
  const retrying = fakeServer(['EADDRNOTAVAIL', 'EADDRNOTAVAIL', 'EADDRNOTAVAIL'])
  const attempts = await listenWithRetry(retrying, { host: LISTEN, port: 18780 }, {
    retry: true, sleep, log: (event, fields) => logs.push({ event, fields }), initialDelayMs: 500, maxDelayMs: 1000
  })
  assert.equal(attempts, 4)
  assert.deepEqual(delays, [500, 1000, 1000])
  assert.deepEqual(retrying.options, { host: LISTEN, port: 18780, exclusive: true })
  assert.equal(retrying.listenerCount('error'), 0)
  assert.equal(retrying.listenerCount('listening'), 0)
  assert.deepEqual(logs.map(entry => entry.fields.code), ['EADDRNOTAVAIL', 'EADDRNOTAVAIL', 'EADDRNOTAVAIL'])
  assert.doesNotMatch(JSON.stringify(logs), /100\./)

  await assert.rejects(listenWithRetry(fakeServer(['EADDRINUSE']), { host: LISTEN, port: 18780 }, { retry: true, sleep }), { code: 'EADDRINUSE' })
  await assert.rejects(listenWithRetry(fakeServer(['EADDRNOTAVAIL']), { host: '127.0.0.1', port: 18780 }, { sleep }), { code: 'EADDRNOTAVAIL' })
  const forever = fakeServer(Array.from({ length: 100 }, () => 'EADDRNOTAVAIL'))
  await assert.rejects(listenWithRetry(forever, { host: LISTEN, port: 18780 }, { retry: true, sleep, maxWaitMs: 5_000 }), { code: 'EADDRNOTAVAIL' })
  assert.ok(forever.attempts < 10)
})

test('the guard alone refuses at connection time: no request or upgrade event is ever emitted', async (t) => {
  const events = []
  const server = createServer(() => events.push('request'))
  server.on('upgrade', (req, socket) => { events.push('upgrade'); socket.destroy() })
  const guard = createPeerGuard({ mode: 'tailnet', allowedPeers: [NGINX] })
  guard.install(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()
  const http = await exchange(port, httpPayload('aidcp.example.test'))
  const ws = await exchange(port, upgradePayload('aidcp.example.test'))
  assert.equal(http.received + ws.received, '')
  assert.deepEqual(events, [])
  assert.equal(guard.refusals(), 2)
})
