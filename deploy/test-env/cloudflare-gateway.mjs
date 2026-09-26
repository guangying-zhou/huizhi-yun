import { drainControlResponse } from './drain/control-proxy.mjs'
import { enterpriseRegistryDigestResponse } from './enterprise-registry-digest.mjs'
import gateway, {
  runScheduledIntegrationDrains,
  runScheduledPolicyBundleSync
} from '../cloudflare/tenant-gateway/src/index.js'

export const TEST_POLICY_SYNC_CRON = '0 16 * * *'
export const TEST_INTEGRATION_DRAIN_CRON = '*/5 * * * *'

export function runTestGatewayScheduled(controller, env, dependencies = {}) {
  const runPolicySync = dependencies.runPolicySync || runScheduledPolicyBundleSync
  const runIntegrationDrains = dependencies.runIntegrationDrains || runScheduledIntegrationDrains
  return controller?.cron === TEST_POLICY_SYNC_CRON
    ? runPolicySync(env)
    : runIntegrationDrains(controller, env)
}

export default {
  async scheduled(controller, env, context) {
    const promise = runTestGatewayScheduled(controller, env)
    context.waitUntil(promise)
    return await promise
  },
  async fetch(request, env) {
    if (new URL(request.url).hostname !== 'hzy-test.huizhi.yun') return new Response('Not Found', { status: 404 })
    const path = new URL(request.url).pathname
    if (path.startsWith('/__test/drain/')) return drainControlResponse(request, env)
    if (path === '/__test/registry-digest') return enterpriseRegistryDigestResponse(request, env)
    if (/^\/(?:altoc|people|workflow|webdev|collab|directory-connector)(?:\/|$)/.test(path)
      || path.startsWith('/api/v1/console/directory-connectors/')) {
      return new Response('Application not enabled in test environment', { status: 503 })
    }
    if (new URL(request.url).pathname === '/__test/policy-sync') {
      if (request.method !== 'POST' || !env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
        || request.headers.get('authorization') !== `Bearer ${env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN}`) return new Response('Not Found', { status: 404 })
      const results = await runScheduledPolicyBundleSync(env)
      return Response.json({ results }, { status: results.length && results.every(r => r.ok) ? 200 : 503,
        headers: { 'cache-control': 'no-store' } })
    }
    const response = await gateway.fetch(request, env)
    const headers = new Headers(response.headers)
    headers.set('x-hzy-test-environment', 'C000001')
    headers.set('cache-control', 'no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
