import type { H3Event } from 'h3'
import { timingSafeEqual } from 'node:crypto'

// A pinned local Dev liveness path through the Nitro request worker. It checks
// an existing gateway secret but performs no session, policy or database work.
export function isLocalWorkerHealthRequest(event: H3Event) {
  if (process.env.NODE_ENV !== 'development' || process.env.HZY0_PROFILE_PATH !== 'hzy0-local-enterprise') return false
  const host = String(event.node?.req?.headers?.host || '')
  const supplied = Buffer.from(String(event.node?.req?.headers?.['x-hzy0-local-health'] || ''))
  const expected = Buffer.from(process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '')
  return /^127\.0\.0\.1:\d+$/.test(host)
    && ['GET', 'HEAD'].includes(String(event.node?.req?.method || event.method))
    && expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
