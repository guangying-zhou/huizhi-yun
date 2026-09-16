// Local-only ingress guard; all supported routing/headers remain in production Gateway.
import gateway, { runScheduledPolicyBundleSync } from '../cloudflare/tenant-gateway/src/index.js'
import { localHostname } from './worker-origin.mjs'
import { validateLocalLogin } from './local-login.mjs'

export function runtimeBinding(binding, token, app) {
  return { async fetch(input, init) {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    if (headers.get('x-hzy-data-runtime-url') === 'https://local-runtime.invalid') {
      // Production Gateway retains the authenticated caller on token exchange.
      const peopleTokenExchange = app === 'console' && request.method === 'POST'
        && new URL(request.url).pathname === '/oauth/token'
        && headers.get('x-hzy-app-code') === 'people'
      const expectedDeployment = app === 'people' || peopleTokenExchange
        ? 'C000001-test-people' : 'wiztek-test-console'
      if (!token || headers.get('x-hzy-gateway-token') !== token
        || headers.get('x-hzy-tenant') !== 'C000001' || headers.get('x-hzy-environment') !== 'test'
        || headers.get('x-hzy-deployment') !== expectedDeployment) {
        return new Response('Untrusted local Runtime route', { status: 403 })
      }
      headers.set('x-hzy-data-runtime-url', 'http://127.0.0.1:18080')
      if (headers.get('x-hzy-scheduler') === 'tenant-gateway') {
        const path = new URL(request.url).pathname
        if (path !== '/api/internal/policy-bundle/sync' || app !== 'console') return new Response(null, { status: 403 })
        const canonical = endpoint => ['POST', path, headers.get('x-request-id'), headers.get('x-hzy-tenant'),
          headers.get('x-hzy-deployment'), 'console', 'test', endpoint, headers.get('x-forwarded-host'), headers.get('x-hzy-scheduler-issued-at')].join('\n')
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        const sign = async value => [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        if (await sign(canonical('https://local-runtime.invalid')) !== headers.get('x-hzy-scheduler-signature')) return new Response(null, { status: 403 })
        headers.set('x-hzy-scheduler-signature', await sign(canonical('http://127.0.0.1:18080')))
      }
    }
    return binding.fetch(new Request(request, { headers }))
  } }
}

export default {
  async fetch(request, env, ctx) {
    if (!['smoke', 'integration'].includes(env.HZY_LOCAL_WORKER_MODE)
      || !env.HZY_CONSOLE_SERVICE?.fetch || !env.HZY_PEOPLE_SERVICE?.fetch) {
      return new Response('Local Worker bindings unavailable', { status: 503 })
    }
    const url = new URL(request.url)
    if (url.pathname === '/__local/policy-sync') {
      if (request.method !== 'POST' || !['127.0.0.1', 'localhost'].includes(url.hostname)
        || !env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
        || request.headers.get('authorization') !== `Bearer ${env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN}`) return new Response(null, { status: 404 })
      const results = await runScheduledPolicyBundleSync({ ...env,
        HZY_CONSOLE_SERVICE: runtimeBinding(env.HZY_CONSOLE_SERVICE, env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN, 'console') })
      return Response.json({ ok: results.length > 0 && results.every(item => item.ok) }, { status: results.length > 0 && results.every(item => item.ok) ? 200 : 503 })
    }
    if (![localHostname, '127.0.0.1', 'localhost'].includes(url.hostname)) return new Response('Unknown local host', { status: 403 })
    // This entrypoint is bound to loopback only. Never derive trusted scheme/host
    // from browser-supplied forwarding headers; Tunnel uses the fixed HTTPS origin.
    url.protocol = 'https:'; url.host = localHostname; url.port = ''
    if (/^\/(?:finance|altoc|aims|assets|codocs|workflow|webdev|collab|directory-connector)(?:\/|$)/.test(url.pathname)
      || url.pathname.startsWith('/api/v1/console/directory-connectors/')) {
      return new Response('Application not enabled in local stack', { status: 503 })
    }
    // Local telemetry sink: intentionally discarded, not a production collector.
    if (['/api/rum', '/rum', '/cdn-cgi/rum'].includes(url.pathname)) return new Response(null, { status: 204 })
    // A smoke run proves Worker transport only; never pretend auth/business works.
    if (env.HZY_LOCAL_WORKER_MODE === 'smoke' && /\/(?:api|oauth)(?:\/|$)/.test(url.pathname)
      && !url.pathname.startsWith('/api/_nuxt_icon/')) {
      return new Response('Local integration credentials not provisioned', { status: 503 })
    }
    if (env.HZY_LOCAL_WORKER_MODE === 'integration') {
      let login
      try { login = validateLocalLogin(JSON.parse(env.HZY_LOCAL_LOGIN_JSON || '')) }
      catch { return new Response('Local login configuration unavailable', { status: 503 }) }
      const registry = JSON.parse(env.HZY_TENANT_GATEWAY_REGISTRY_JSON)
      registry.domains[localHostname].login = { mode: 'oidc', enabledProviders: ['oidc'], oidc: login }
      env = { ...env, HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify(registry),
        HZY_CONSOLE_SERVICE: runtimeBinding(env.HZY_CONSOLE_SERVICE, env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN, 'console'),
        HZY_PEOPLE_SERVICE: runtimeBinding(env.HZY_PEOPLE_SERVICE, env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN, 'people') }
    }
    const response = await gateway.fetch(new Request(url, request), env, ctx)
    // Developer builds and transient failures must never stick in Tunnel/CDN
    // caches. Production cache policy remains untouched by this local wrapper.
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
