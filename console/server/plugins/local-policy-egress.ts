import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'

export default defineNitroPlugin((nitro) => {
  if (process.env.HZY0_LOCAL_CONSOLE_FACADE !== 'true' || !process.env.HZY0_POLICY_EGRESS_URL) return
  if (process.env.HZY_PLATFORM_BUNDLE_CACHE_BACKEND !== 'verified-runtime'
    || process.env.HZY0_POLICY_EGRESS_URL !== 'http://127.0.0.1:23121/__hzy0/platform-policy') throw Error('Invalid policy egress configuration')
  nitro.hooks.hook('request', (event) => {
    const context = resolveTrustedTenantGatewayContext(event)
    if (!context || context.tenant !== 'C000001' || context.environment !== 'test'
      || context.appCode !== 'console' || context.deployment !== 'wiztek-test-console') return
    event.context.hzyPlatformTransport = {
      async fetch(input: string | URL, init: RequestInit = {}) {
        const target = new URL(input)
        // Steady service key registration (R1): one fixed POST, body checked again by the Gateway.
        if (target.href === 'https://hzy.wiztek.cn/api/platform/internal/console/tenants/C000001/service-keys') {
          if (init.method !== 'POST' || typeof init.body !== 'string' || init.body.length > 1024) throw Error('Unapproved policy destination')
          return fetch(`${process.env.HZY0_POLICY_EGRESS_URL!}-service-key`, { method: 'POST', redirect: 'error', body: init.body,
            signal: init.signal, headers: { 'content-type': 'application/json', 'x-hzy0-egress-token': process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '' } })
        }
        // The envelope and its lightweight revision probe; each has a fixed private path.
        const format = target.searchParams.get('format')
        const sourcePath = (event.path || '').split('?')[0] || ''
        const schedulerSync = /^\/(?:console\/)?api\/internal\/policy-bundle\/sync$/.test(sourcePath)
        const serviceAuthorizationRead = /^\/(?:console\/)?api\/v1\/console\/service\/authorization\/(?:role-holders|subject-eligibility)$/.test(sourcePath)
        let egressUrl = ''
        if (format === 'hzy-policy-envelope.v1') egressUrl = process.env.HZY0_POLICY_EGRESS_URL!
        if (format === 'hzy-policy-revision.v1') {
          if (!schedulerSync && !serviceAuthorizationRead) throw Error('Unapproved policy source')
          egressUrl = `${process.env.HZY0_POLICY_EGRESS_URL!}-revision${schedulerSync ? '' : '-live'}`
        }
        const expected = { environment: 'test', deploymentCode: 'wiztek-test-console' }
        if (!egressUrl || target.origin !== 'https://hzy.wiztek.cn' || target.username || target.password || target.hash
          || target.pathname !== '/api/platform/internal/console/tenants/C000001/bundle'
          || [...target.searchParams].length !== 3 || Object.entries(expected).some(([key, value]) => target.searchParams.get(key) !== value)
          || (init.method || 'GET') !== 'GET' || init.body) throw Error('Unapproved policy destination')
        // Caller headers (including the local Gateway token supplied by the
        // legacy Platform config) never go to the remote control plane.
        return fetch(egressUrl, { method: 'GET', redirect: 'error',
          signal: init.signal, headers: { 'x-hzy0-egress-token': process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '' } })
      }
    }
  })
})
