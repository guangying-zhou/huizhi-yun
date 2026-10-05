// Read-only probes for the standalone Collab service (G-4 / Codocs collaboration
// go-live). Nothing here writes data, sends a ticket, or logs headers/tokens:
// the WebSocket probe completes the RFC 6455 handshake and closes without any
// application frame, so Collab never reaches ticket redemption or the Runtime.
import { createHash, randomBytes } from 'node:crypto'
import { connect as netConnect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { connect as tlsConnect } from 'node:tls'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
export const COLLAB_LOOPBACK = '127.0.0.1'

function tryConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port })
    const done = (connected) => { socket.destroy(); resolve(connected) }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * The listener must answer on 127.0.0.1 and must NOT answer on ::1 or any other
 * local address (a 0.0.0.0/:: bind would). `interfaces` is injectable for tests.
 */
export async function checkLoopbackListener({ port, interfaces = networkInterfaces, timeoutMs = 1500 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('collab listener port invalid')
  if (!await tryConnect(COLLAB_LOOPBACK, port, timeoutMs)) throw Error('collab is not listening on 127.0.0.1')
  const exposed = []
  // A wildcard bind (the Hocuspocus default) also answers on ::1; 127.0.0.1-only does not.
  if (await tryConnect('::1', port, timeoutMs)) exposed.push('wildcard')
  for (const entries of Object.values(interfaces())) {
    for (const entry of entries || []) {
      if (entry.internal || !entry.address || entry.address.startsWith('fe80:')) continue
      if (await tryConnect(entry.address, port, timeoutMs)) exposed.push(entry.family)
    }
  }
  if (exposed.length) throw Error('collab listens beyond loopback')
  return { loopback: true }
}

function openSocket(target, publicHost) {
  const url = new URL(target)
  const secure = url.protocol === 'https:'
  const port = Number(url.port || (secure ? 443 : 80))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('gateway url invalid')
  return secure
    ? tlsConnect({ host: url.hostname, port, servername: publicHost })
    : netConnect({ host: url.hostname, port })
}

function exchange(target, publicHost, requestText, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = openSocket(target, publicHost)
    let buffer = ''
    const finish = (error, value) => { socket.destroy(); error ? reject(error) : resolve(value) }
    socket.setTimeout(timeoutMs, () => finish(Error('collab probe timed out')))
    socket.once('error', () => finish(Error('collab probe connection failed')))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1')
      if (buffer.includes('\r\n\r\n')) finish(null, buffer)
    })
    socket.once('close', () => { if (!buffer.includes('\r\n\r\n')) finish(Error('collab probe closed without a response')) })
    socket.once(secure(target) ? 'secureConnect' : 'connect', () => socket.write(requestText))
  })
}
const secure = target => new URL(target).protocol === 'https:'

function statusOf(head) {
  const match = /^HTTP\/1\.[01] (\d{3}) /.exec(head)
  return match ? Number(match[1]) : 0
}
function headerOf(head, name) {
  const match = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(head)
  return match ? match[1].trim() : ''
}

/** GET /codocs/ws without Upgrade must be refused with 426 (never proxied to Collab). */
export async function probePlainHttp({ gatewayUrl, publicHost, timeoutMs = 5000 }) {
  const head = await exchange(gatewayUrl, publicHost, `GET /codocs/ws HTTP/1.1\r\nHost: ${publicHost}\r\nConnection: close\r\nAccept: */*\r\nOrigin: https://${publicHost}\r\n\r\n`, timeoutMs)
  const status = statusOf(head)
  if (status !== 426) throw Error(`plain HTTP /codocs/ws returned ${status}, expected 426`)
  return { status }
}

/** Handshake through the Gateway must return 101 with the correct accept key. No frame is sent. */
export async function probeWebSocketUpgrade({ gatewayUrl, publicHost, path = '/codocs/ws', timeoutMs = 5000 }) {
  const key = randomBytes(16).toString('base64')
  const head = await exchange(gatewayUrl, publicHost,
    `GET ${path} HTTP/1.1\r\nHost: ${publicHost}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nOrigin: https://${publicHost}\r\n\r\n`, timeoutMs)
  const status = statusOf(head)
  if (status !== 101) throw Error(`websocket upgrade via gateway returned ${status}, expected 101`)
  const accept = createHash('sha1').update(`${key}${GUID}`).digest('base64')
  if (headerOf(head, 'sec-websocket-accept') !== accept) throw Error('websocket accept key mismatch')
  return { status }
}

export async function checkCollabDeep({ port, gatewayUrl, publicHost }) {
  const listener = await checkLoopbackListener({ port })
  const plain = await probePlainHttp({ gatewayUrl, publicHost })
  const upgrade = await probeWebSocketUpgrade({ gatewayUrl, publicHost })
  return { listener, plain: plain.status, upgrade: upgrade.status }
}
