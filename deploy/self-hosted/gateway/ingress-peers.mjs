// Ingress peer allowlist for the optional tailnet listener.
//
// Topology: browser → nginx (TLS, public host) → Tailscale → this gateway on
// its Tailscale address. The gateway accepts TCP connections only from the
// configured nginx peers; everything else is destroyed before a single byte is
// parsed (HTTP and WebSocket upgrades alike). Addresses are never logged.
import { isIP } from 'node:net'

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const STRICT_IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`)
export const LOOPBACK_LISTEN_HOSTS = Object.freeze(['127.0.0.1', '::1'])
export const MAX_ALLOWED_PEERS = 16
// Tailscale's own service address (MagicDNS/quad-100) is never a peer or bind.
const TAILSCALE_SERVICE_ADDRESS = '100.100.100.100'
const REFUSAL_LOG_INTERVAL_MS = 60_000
const BIND_RETRY_CODES = new Set(['EADDRNOTAVAIL'])

/** Strict dotted-decimal IPv4 (no leading zeros, no shorthand). */
export function isStrictIPv4(value) {
  return typeof value === 'string' && STRICT_IPV4.test(value)
}

/**
 * A single host address inside Tailscale's CGNAT range 100.64.0.0/10,
 * excluding the network/broadcast addresses and Tailscale's service address.
 */
export function isTailnetAddress(value) {
  if (!isStrictIPv4(value)) return false
  const [first, second] = value.split('.').map(Number)
  if (first !== 100 || (second & 0xc0) !== 0x40) return false
  return value !== '100.64.0.0' && value !== '100.127.255.255' && value !== TAILSCALE_SERVICE_ADDRESS
}

/** `::ffff:a.b.c.d` (any case) → `a.b.c.d`; anything unparseable → ''. */
export function normalizePeerAddress(address) {
  if (typeof address !== 'string') return ''
  let value = address.trim()
  if (/^::ffff:/i.test(value) && isStrictIPv4(value.slice(7))) value = value.slice(7)
  return isIP(value) ? value.toLowerCase() : ''
}

export function isLoopbackAddress(address) {
  const value = normalizePeerAddress(address)
  return value === '::1' || /^127\./.test(value)
}

/**
 * Connection-time peer guard. Loopback mode admits loopback peers only (which
 * is all a loopback bind can receive, so the default is unchanged); tailnet
 * mode admits exactly the configured peers.
 */
export function createPeerGuard({ mode, allowedPeers = [] }, { log = () => {}, now = Date.now } = {}) {
  const allowed = new Set(allowedPeers)
  let refusals = 0
  let unloggedRefusals = 0
  let lastLogAt = -Infinity

  const allows = (address) => {
    const peer = normalizePeerAddress(address)
    if (!peer) return false
    return mode === 'tailnet' ? allowed.has(peer) : isLoopbackAddress(peer)
  }

  const refuse = (socket) => {
    refusals += 1
    unloggedRefusals += 1
    socket.destroy()
    // Only the fact and count of refusals are logged — never the address.
    const time = now()
    if (time - lastLogAt >= REFUSAL_LOG_INTERVAL_MS) {
      lastLogAt = time
      log('gateway-ingress-peer-refused', { refusals, sinceLastLog: unloggedRefusals })
      unloggedRefusals = 0
    }
  }

  /** Returns true when the socket was refused (and destroyed). */
  const check = (socket) => {
    if (allows(socket?.remoteAddress)) return false
    refuse(socket)
    return true
  }

  /**
   * Install on an HTTP server. The listener is prepended so it runs before
   * the HTTP parser is attached; a refused socket never produces a request,
   * an upgrade or a response.
   */
  const install = (server) => {
    server.prependListener('connection', (socket) => { check(socket) })
  }

  return {
    mode,
    allows,
    check,
    install,
    refusals: () => refusals,
    snapshot: () => ({ mode, allowedPeerCount: allowed.size, peerRefusals: refusals })
  }
}

/**
 * Audit client address for the tailnet mode, derived only from an allowlisted
 * peer's `X-Real-IP` (nginx sets it from `$remote_addr`). A missing, malformed,
 * repeated, loopback or unspecified value falls back to the peer address
 * itself, so the value handed to the apps is never loopback. It is advisory
 * (audit logs) and never an identity: the gateway makes no decision on it.
 */
export function auditClientAddress(req, guard) {
  const peer = normalizePeerAddress(req.socket?.remoteAddress)
  if (!peer || !guard.allows(peer)) return null
  const header = req.headers['x-real-ip']
  const claimed = typeof header === 'string' && header.length <= 64 ? normalizePeerAddress(header) : ''
  if (!claimed || isLoopbackAddress(claimed) || claimed === '0.0.0.0' || claimed === '::') return peer
  return claimed
}

/**
 * Listen, retrying only EADDRNOTAVAIL (the tailnet address is not assigned
 * yet, e.g. tailscaled still starting) with capped exponential backoff.
 */
export async function listenWithRetry(server, { host, port }, {
  retry = false,
  maxWaitMs = 120_000,
  initialDelayMs = 500,
  maxDelayMs = 10_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = () => {}
} = {}) {
  let waited = 0
  let delay = initialDelayMs
  for (let attempt = 1; ; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        // Both listeners are removed whichever fires, so retries leave nothing behind.
        const onError = (error) => { server.off('listening', onListening); reject(error) }
        const onListening = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen({ host, port, exclusive: true })
      })
      return attempt
    } catch (error) {
      if (!retry || !BIND_RETRY_CODES.has(error?.code) || waited + delay > maxWaitMs) throw error
      log('gateway-ingress-bind-retry', { attempt, code: error.code, delayMs: delay })
      await sleep(delay)
      waited += delay
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }
}
