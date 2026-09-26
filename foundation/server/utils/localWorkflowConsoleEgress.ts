import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'
import type { H3Event } from 'h3'

export function installLocalWorkflowConsoleEgress(event: H3Event, appCode: 'aims' | 'workflow') {
  if (process.env.HZY0_WORKFLOW_LOCAL_ONLY !== 'true') return
  const endpoint = String(process.env.HZY0_CONSOLE_EGRESS_URL || '')
  const deployment = appCode === 'aims' ? 'C000001-test-aims' : 'C000001-test-workflow-local'
  const context = resolveTrustedTenantGatewayContext(event)
  if (endpoint !== 'http://127.0.0.1:23121' || !context || context.tenant !== 'C000001'
    || context.environment !== 'test' || context.appCode !== appCode || context.deployment !== deployment) return
  event.context.hzyConsoleTransport = {
    async fetch(input: string | URL | Request, init?: RequestInit) {
      if (input instanceof Request) throw Error('Request input is not supported by local Console egress')
      const target = new URL(input)
      if (target.origin !== 'https://hzy-test.huizhi.yun' || target.username || target.password) throw Error('Unapproved Console destination')
      const secret = String(process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '')
      if (!secret) throw Error('Local Console egress credential unavailable')
      const headers = new Headers(init?.headers)
      headers.set('x-hzy0-egress-token', secret)
      return fetch(`${endpoint}${target.pathname}${target.search}`, { ...init, headers, redirect: 'error' })
    }
  }
}
