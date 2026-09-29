import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'

export default defineNitroPlugin(nitro => {
  if (process.env.HZY0_LOCAL_ENTERPRISE !== 'true' || !process.env.HZY0_CONSOLE_EGRESS_URL) return
  const endpoint = new URL(process.env.HZY0_CONSOLE_EGRESS_URL)
  if (endpoint.origin !== 'http://127.0.0.1:23121' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw Error('Invalid local Console egress')
  nitro.hooks.hook('request', event => {
    const context = resolveTrustedTenantGatewayContext(event)
    if (!context || context.tenant !== 'C000001' || context.environment !== 'test'
      || context.appCode !== 'enterprise' || context.deployment !== 'C000001-test-enterprise') return
    event.context.hzyConsoleTransport = {
      async fetch(input: string | URL | Request, init?: RequestInit) {
        if (input instanceof Request) throw Error('Request input is not supported by local Console egress')
        const target = new URL(input)
        if (target.origin !== 'https://hzy-test.huizhi.yun' || target.username || target.password) throw Error('Unapproved Console destination')
        const headers = new Headers(init?.headers)
        headers.set('x-hzy0-egress-token', process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '')
        return fetch(`${endpoint.origin}${target.pathname}${target.search}`, { ...init, headers, redirect: 'error' })
      }
    }
  })
})
