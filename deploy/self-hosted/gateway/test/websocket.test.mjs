import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import test from 'node:test'
import { probePlainHttp, probeWebSocketUpgrade } from '../../collab-probe.mjs'
import { configFor, startGateway, startUpstream } from './fixtures.mjs'

// Mock Collab: completes the RFC 6455 handshake, then echoes raw bytes.
async function startCollab({ refuse = false } = {}) {
  const upgrades = []
  const server = createServer((req, res) => { res.writeHead(426); res.end() })
  server.on('upgrade', (req, socket) => {
    upgrades.push({ url: req.url, headers: req.headers })
    if (refuse) {
      socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n')
      return
    }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nx-hzy-debug: internal\r\n\r\n`)
    socket.on('data', chunk => socket.write(Buffer.concat([Buffer.from('echo:'), chunk])))
    socket.on('end', () => socket.destroy())
    socket.on('error', () => socket.destroy())
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { name: 'collab', origin: `http://127.0.0.1:${server.address().port}`, upgrades, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }) }
}

function upgradeRequest(port, { host, path = '/codocs/ws', origin, extra = {} }) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1')
      if (buffer.includes('\r\n\r\n')) resolve({ socket, head: buffer })
    })
    socket.on('error', reject)
    socket.on('close', () => resolve({ socket, head: buffer }))
    const lines = [
      `GET ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: Upgrade', 'Upgrade: websocket',
      'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      ...(origin ? [`Origin: ${origin}`] : []),
      ...Object.entries(extra).map(([name, value]) => `${name}: ${value}`)
    ]
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
  })
}

async function setup(t, collabOptions) {
  const consoleUpstream = await startUpstream('console')
  const collab = await startCollab(collabOptions)
  const config = configFor([consoleUpstream, collab])
  const gateway = await startGateway(config)
  t.after(async () => {
    await gateway.close()
    await consoleUpstream.close()
    await collab.close()
  })
  return { config, gateway, collab }
}

test('collab WebSocket upgrade is spliced to the loopback Collab without credentials', async (t) => {
  const { config, gateway, collab } = await setup(t)
  const { socket, head } = await upgradeRequest(gateway.port, {
    host: config.site.publicHost,
    origin: `https://${config.site.publicHost}`,
    extra: { Cookie: 'sid=secret-session', Authorization: 'Bearer user-token', 'x-hzy-gateway-token': 'forged', 'x-hzy-tenant': 'OTHER' }
  })
  t.after(() => socket.destroy())
  assert.match(head, /^HTTP\/1\.1 101 /)
  assert.match(head, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i)
  assert.doesNotMatch(head, /x-hzy-debug/i)
  const upstream = collab.upgrades.at(-1)
  assert.equal(upstream.url, '/codocs/ws')
  assert.equal(upstream.headers.cookie, undefined)
  assert.equal(upstream.headers.authorization, undefined)
  assert.equal(upstream.headers['x-hzy-gateway-token'], undefined)
  assert.equal(upstream.headers['x-hzy-tenant'], config.site.tenantCode)
  assert.equal(upstream.headers['x-forwarded-host'], config.site.publicHost)
  assert.equal(upstream.headers.origin, `https://${config.site.publicHost}`)

  const echoed = await new Promise((resolve) => {
    socket.once('data', chunk => resolve(chunk.toString()))
    socket.write('frame-bytes')
  })
  assert.equal(echoed, 'echo:frame-bytes')
  assert.equal(gateway.upgrade.activeCount(), 1)
  socket.destroy()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(gateway.upgrade.activeCount(), 0)
})

test('upgrades from a foreign Origin, wrong Host or non-collab path are refused before dialling', async (t) => {
  const { config, gateway, collab } = await setup(t)
  const foreign = await upgradeRequest(gateway.port, { host: config.site.publicHost, origin: 'https://evil.example.test' })
  assert.match(foreign.head, /^HTTP\/1\.1 403 /)
  const noOrigin = await upgradeRequest(gateway.port, { host: config.site.publicHost })
  assert.match(noOrigin.head, /^HTTP\/1\.1 403 /)
  const wrongHost = await upgradeRequest(gateway.port, { host: 'wiztek.huizhi.yun', origin: `https://${config.site.publicHost}` })
  assert.match(wrongHost.head, /^HTTP\/1\.1 421 /)
  const otherPath = await upgradeRequest(gateway.port, { host: config.site.publicHost, path: '/enterprise/_nuxt/hmr', origin: `https://${config.site.publicHost}` })
  assert.match(otherPath.head, /^HTTP\/1\.1 404 /)
  assert.equal(collab.upgrades.length, 0)
})

test('an upstream refusal is relayed as an error and releases the slot', async (t) => {
  const { config, gateway } = await setup(t, { refuse: true })
  const refused = await upgradeRequest(gateway.port, { host: config.site.publicHost, origin: `https://${config.site.publicHost}` })
  assert.match(refused.head, /^HTTP\/1\.1 403 /)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(gateway.upgrade.activeCount(), 0)
})

test('a plain HTTP request to the collaboration socket is answered 426 without dialling Collab', async (t) => {
  const { config, gateway, collab } = await setup(t)
  const response = await gateway.request('/codocs/ws', { headers: new Headers({ Origin: `https://${config.site.publicHost}` }) })
  assert.equal(response.status, 426)
  assert.equal(response.headers.upgrade, 'websocket')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.body, 'Upgrade Required')
  assert.equal(collab.upgrades.length, 0)
})

test('/collab/* upgrades are spliced; near-miss paths are refused before dialling', async (t) => {
  const { config, gateway, collab } = await setup(t)
  const ok = await upgradeRequest(gateway.port, { host: config.site.publicHost, path: '/collab/socket?x=1', origin: `https://${config.site.publicHost}` })
  assert.match(ok.head, /^HTTP\/1\.1 101 /)
  assert.equal(collab.upgrades.at(-1).url, '/collab/socket?x=1')
  ok.socket.destroy()
  await new Promise(resolve => setTimeout(resolve, 50))
  const before = collab.upgrades.length
  for (const path of ['/collab', '/codocs/ws/extra', '/codocs/wss']) {
    const refused = await upgradeRequest(gateway.port, { host: config.site.publicHost, path, origin: `https://${config.site.publicHost}` })
    assert.match(refused.head, /^HTTP\/1\.1 (?:400|404) /, path)
    refused.socket.destroy()
  }
  assert.equal(collab.upgrades.length, before)
})

test('the read-only Collab probes see 101 for a bare handshake and 426 for plain HTTP through the Gateway', async (t) => {
  const { config, gateway, collab } = await setup(t)
  const gatewayUrl = `http://127.0.0.1:${gateway.port}`
  assert.deepEqual(await probePlainHttp({ gatewayUrl, publicHost: config.site.publicHost }), { status: 426 })
  assert.equal(collab.upgrades.length, 0, 'the plain probe never reaches Collab')
  assert.deepEqual(await probeWebSocketUpgrade({ gatewayUrl, publicHost: config.site.publicHost }), { status: 101 })
  assert.equal(collab.upgrades.at(-1).url, '/codocs/ws')
  // The handshake probe sends no application frame and lets go.
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(gateway.upgrade.activeCount(), 0)
  // A wrong public host is not a healthy path.
  await assert.rejects(probeWebSocketUpgrade({ gatewayUrl, publicHost: 'other.selfhosted-fixture.test' }), /returned 421/)
})

test('the Collab probes fail when the path does not behave (refusing Collab, plain 200)', async (t) => {
  const { config, gateway } = await setup(t, { refuse: true })
  const gatewayUrl = `http://127.0.0.1:${gateway.port}`
  await assert.rejects(probeWebSocketUpgrade({ gatewayUrl, publicHost: config.site.publicHost }), /returned 403, expected 101/)
  const plain = createServer((_, res) => res.end('Welcome'))
  await new Promise(resolve => plain.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => plain.close(resolve)))
  await assert.rejects(probePlainHttp({ gatewayUrl: `http://127.0.0.1:${plain.address().port}`, publicHost: config.site.publicHost }), /returned 200, expected 426/)
})
