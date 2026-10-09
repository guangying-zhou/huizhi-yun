import { isIP } from 'node:net'
import { getHeader, type H3Event } from 'h3'

function normalize(value: unknown) {
  const text = String(value || '').trim().replace(/^::ffff:/i, '')
  return isIP(text) ? text : ''
}

function proxyPeer(address: string) {
  return address === '::1' || /^127\./.test(address) || /^10\./.test(address) || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address) || /^f[cd][0-9a-f]{2}:/i.test(address) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
}

/**
 * Client address for audit records of sensitive actions.
 *
 * `X-Forwarded-For` is never read: a browser can put anything in front of it.
 * `X-Real-IP` is used only when the connection itself comes from a proxy on a
 * loopback or private address, because every supported Tenant Gateway either
 * overwrites that header with the address it saw or strips it. A request that
 * reaches the Host directly is recorded with its socket address.
 */
export function trustedClientAddress(event: H3Event) {
  const peer = normalize(event.node.req.socket?.remoteAddress)
  if (peer && proxyPeer(peer)) {
    const forwarded = normalize(getHeader(event, 'x-real-ip'))
    if (forwarded) return forwarded
  }
  return peer
}

/** Self-reported by the browser; recorded as context only, bounded and printable. */
export function reportedUserAgent(event: H3Event) {
  // eslint-disable-next-line no-control-regex
  return String(getHeader(event, 'user-agent') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 255)
}
