import { getRequestURL } from 'h3'
import { requireTenantGatewaySchedulerRequest } from './tenantGatewayTrust'
import { localCodocsEgressCredential } from '../../shared/utils/localCodocsEgressCredential'
import type { H3Event } from 'h3'

const CONSOLE_ORIGIN = 'https://hzy-test.huizhi.yun'
const EGRESS_ORIGIN = 'http://127.0.0.1:23121'
const SERVICE_PATH = /^\/codocs\/api\/v1\/service\/company-weekly-summaries\/[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3]):publish$/

/** Local hzy0 transport only. Console remains the token verification authority. */
export async function installLocalCodocsConsoleEgress(event: H3Event) {
  if (process.env.HZY0_CODOCS_LOCAL_ONLY !== 'true' || process.env.HZY0_LOCAL_ENTERPRISE !== 'true') return
  if (process.env.HZY0_CONSOLE_EGRESS_URL !== EGRESS_ORIGIN) return
  const path = getRequestURL(event).pathname
  if (!SERVICE_PATH.test(path)) return
  let context
  try {
    context = await requireTenantGatewaySchedulerRequest(event, 'codocs', path)
  } catch {
    return
  }
  if (!context || context.tenant !== 'C000001' || context.environment !== 'test'
    || context.appCode !== 'codocs' || context.deployment !== 'C000001-test-codocs') return
  event.context.hzyConsoleTransport = {
    async fetch(input: string | URL | Request, init?: RequestInit) {
      if (input instanceof Request) throw Error('Request input is not supported by local Console egress')
      const target = new URL(input)
      if (target.origin !== CONSOLE_ORIGIN || target.username || target.password) throw Error('Unapproved Console destination')
      const secret = localCodocsEgressCredential(String(process.env.HZY_CODOCS_SERVICE_CLIENT_SECRET || ''))
      const headers = new Headers(init?.headers)
      headers.set('x-hzy0-egress-token', secret)
      // Cloudflare Workers reject redirect:'error' before the request is sent.
      // Manual leaves 3xx visible to the introspection caller, which fails closed.
      return fetch(`${EGRESS_ORIGIN}${target.pathname}${target.search}`, { ...init, headers, redirect: 'manual' })
    }
  }
}
