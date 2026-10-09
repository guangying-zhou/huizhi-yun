import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createLoopbackServiceBinding,
  resolveSelfHostedRuntimeDialEndpoint,
  selfHostedServiceBinding
} from '../server/utils/selfHostedServiceTransport.ts'
import { consoleServiceBinding, consoleServiceFetch } from '../server/utils/consoleServiceBinding.ts'
import { appServiceBinding, serviceAppFetch } from '../server/utils/appServiceBinding.ts'
import { requestServiceAccessToken } from '../server/utils/serviceOidc.ts'
import {
  resolveRuntimeDialEndpoint,
  verifiedLocalTestRuntimeDialEndpoint
} from '../server/utils/localTestRuntimeTransport.ts'

type Seen = { method: string, url: string, headers: IncomingMessage['headers'], body: string }

const ENV_NAMES = [
  'HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON', 'HZY_SELF_HOSTED_RUNTIME_ENDPOINT', 'HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN',
  'HZY0_LOCAL_ENTERPRISE', 'HZY0_WORKFLOW_LOCAL_ONLY', 'HZY0_LOCAL_CONSOLE_FACADE', 'HZY_CLOUDFLARE_BUILD', 'HZY_CLOUDFLARE_RUNTIME',
  'HZY_CODOCS_TARGET_DEPLOYMENT'
]

function withEnv<T>(values: Record<string, string>, run: () => T): T {
  const previous = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]))
  for (const name of ENV_NAMES) Reflect.deleteProperty(process.env, name)
  Object.assign(process.env, values)
  const restore = () => {
    for (const name of ENV_NAMES) {
      if (previous[name] === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = previous[name]
    }
  }
  try {
    const result = run()
    if (result instanceof Promise) return result.finally(restore) as T
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

const event = (headers: Record<string, string> = {}, env: Record<string, unknown> = {}) =>
  ({ context: { cloudflare: { env } }, node: { req: { headers } } }) as never

let server: Server
let origin = ''
const seen: Seen[] = []
let nextStatus = 200

before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      seen.push({ method: req.method || '', url: req.url || '', headers: req.headers, body })
      if (nextStatus === 302) {
        res.writeHead(302, { location: 'https://public.example.test/elsewhere' }).end()
        return
      }
      res.writeHead(nextStatus, { 'content-type': 'application/json' })
      res.end(JSON.stringify(nextStatus === 200 ? { code: 0, data: { ok: true } } : { message: 'denied' }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => new Promise<void>(resolve => server.close(() => resolve())))

function servicesEnv(extra: Record<string, string> = {}) {
  return { HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: JSON.stringify({ console: origin, workflow: origin, ...extra }) }
}

describe('self-hosted loopback service transport', () => {
  test('is disabled (null) unless explicitly configured, so managed cloud and hzy0 keep their paths', () => {
    withEnv({}, () => {
      assert.equal(selfHostedServiceBinding('console'), null)
      assert.equal(consoleServiceBinding(event()), null)
      assert.equal(appServiceBinding(event(), 'workflow'), null)
    })
  })

  test('a real Cloudflare Service Binding still wins over the loopback transport', () => {
    const binding = { fetch: async () => new Response('{}') }
    withEnv(servicesEnv(), () => {
      assert.equal(consoleServiceBinding(event({}, { HZY_CONSOLE_SERVICE: binding })), binding)
      assert.equal(appServiceBinding(event({}, { HZY_WORKFLOW_SERVICE: binding }), 'workflow'), binding)
    })
  })

  test('Console calls dial the local Console KEEPING the /console prefix (self-hosted Console serves under /console/) and caller headers intact', async () => {
    seen.length = 0
    nextStatus = 200
    await withEnv(servicesEnv(), async () => {
      const data = await consoleServiceFetch<{ code: number }>(event(), 'https://site.example.test/console/api/v1/console/service/x', {
        params: { page: 2 },
        headers: { 'authorization': 'Bearer caller-token', 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-app-code': 'enterprise' }
      })
      assert.equal(data.code, 0)
    })
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.url, '/console/api/v1/console/service/x?page=2')
    assert.equal(seen[0]!.headers.authorization, 'Bearer caller-token')
    assert.equal(seen[0]!.headers['x-hzy-app-code'], 'enterprise', 'source identity header is not rewritten for Console')
    assert.equal(seen[0]!.headers.host, new URL(origin).host, 'public host is never dialed')
  })

  test('app calls keep the /{app} base path and rewrite the target context atomically (stripped without catalog)', async () => {
    seen.length = 0
    nextStatus = 200
    await withEnv(servicesEnv(), async () => {
      await serviceAppFetch(null, 'workflow', 'https://site.example.test/workflow/api/v1/service/thing?q=1', {
        method: 'POST',
        headers: { 'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'source-deployment', 'x-forwarded-prefix': '/aims', 'idempotency-key': 'k1' },
        body: { a: 1 }
      })
    })
    assert.equal(seen[0]!.method, 'POST')
    assert.equal(seen[0]!.url, '/workflow/api/v1/service/thing?q=1')
    assert.equal(seen[0]!.body, JSON.stringify({ a: 1 }))
    assert.equal(seen[0]!.headers['idempotency-key'], 'k1')
    for (const name of ['x-hzy-app-code', 'x-hzy-deployment', 'x-forwarded-prefix']) {
      assert.equal(seen[0]!.headers[name], undefined, `${name} from the source must never reach the target`)
    }
  })

  test('event-less Codocs delivery binds all target headers only to the server-owned deployment', async () => {
    seen.length = 0
    nextStatus = 200
    await withEnv({ ...servicesEnv({ codocs: origin }), HZY_CODOCS_TARGET_DEPLOYMENT: 'C000001-codocs' }, async () => {
      await serviceAppFetch(null, 'codocs', 'https://site.example.test/codocs/api/v1/service/company-weekly-summaries/2026-W40:publish', {
        method: 'POST', scheduledTargetDeployment: 'C000001-codocs',
        headers: { 'x-hzy-tenant': 'C000001', 'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'C000001-aims', 'x-forwarded-prefix': '/aims' },
        body: { serviceCommand: {} }
      })
      assert.equal(seen[0]!.headers['x-hzy-app-code'], 'codocs')
      assert.equal(seen[0]!.headers['x-hzy-deployment'], 'C000001-codocs')
      assert.equal(seen[0]!.headers['x-forwarded-prefix'], '/codocs')
      assert.equal(seen[0]!.headers['x-hzy-tenant'], 'C000001')
      await assert.rejects(serviceAppFetch(null, 'codocs', 'https://site.example.test/codocs/api/x', {
        scheduledTargetDeployment: 'C000001-other', headers: { 'x-hzy-deployment': 'C000001-codocs' }
      }), (error: { statusCode?: number }) => error.statusCode === 503)
      assert.equal(seen.length, 1)
    })
  })

  test('with a verified Gateway catalog the loopback call carries the target app/deployment/prefix', async () => {
    seen.length = 0
    nextStatus = 200
    const globals = globalThis as { useRuntimeConfig?: unknown }
    const original = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: 'gateway-fixture' } })
    const inbound = event({
      'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'gateway-fixture', 'x-hzy-tenant': 'T1',
      'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'T1-aims', 'x-hzy-environment': 'prod', 'x-forwarded-host': 'site.example.test',
      'x-hzy-service-routes': JSON.stringify({ workflow: { origin: origin, deploymentCode: 'T1-workflow', basePath: '/workflow/' } })
    })
    try {
      await withEnv(servicesEnv(), async () => {
        await serviceAppFetch(inbound, 'workflow', 'https://site.example.test/workflow/api/v1/service/x', {
          method: 'POST', headers: { 'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'T1-aims' }, body: {}
        })
      })
    } finally {
      globals.useRuntimeConfig = original
    }
    assert.equal(seen[0]!.headers['x-hzy-app-code'], 'workflow')
    assert.equal(seen[0]!.headers['x-hzy-deployment'], 'T1-workflow')
    assert.equal(seen[0]!.headers['x-forwarded-prefix'], '/workflow')
  })

  test('service-token exchange reaches the local Console with the verified source identity', async () => {
    seen.length = 0
    nextStatus = 200
    const globals = globalThis as { useRuntimeConfig?: unknown, $fetch?: unknown }
    const originalConfig = globals.useRuntimeConfig
    const originalFetch = globals.$fetch
    globals.useRuntimeConfig = () => ({ hzy: { appCode: 'enterprise', cloudflareInternalToken: 'gateway-fixture', serviceClient: { clientId: 'enterprise.runtime' } } })
    globals.$fetch = async () => {
      throw new Error('public fallback must not be used')
    }
    const tokenServer = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        seen.push({ method: req.method || '', url: req.url || '', headers: req.headers, body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ access_token: 'loopback-token', token_type: 'Bearer', expires_in: 300 }))
      })
    })
    await new Promise<void>(resolve => tokenServer.listen(0, '127.0.0.1', resolve))
    const tokenOrigin = `http://127.0.0.1:${(tokenServer.address() as AddressInfo).port}`
    const inbound = event({
      'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'gateway-fixture', 'x-hzy-tenant': 'T1',
      'x-hzy-app-code': 'enterprise', 'x-hzy-deployment': 'T1-enterprise', 'x-hzy-environment': 'prod',
      'x-forwarded-host': 'site.example.test', 'x-forwarded-proto': 'https'
    })
    try {
      const token = await withEnv({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: JSON.stringify({ console: tokenOrigin }) }, () =>
        requestServiceAccessToken({ audience: 'aims', scope: 'aims:enterprise-host:execute', event: inbound }))
      assert.equal(token, 'loopback-token')
    } finally {
      globals.useRuntimeConfig = originalConfig
      globals.$fetch = originalFetch
      await new Promise<void>(resolve => tokenServer.close(() => resolve()))
    }
    const call = seen.find(item => item.url === '/console/oauth/token')
    assert.ok(call, 'token request dialed the local Console /console/oauth/token')
    assert.equal(call.headers['x-hzy-gateway-token'], 'gateway-fixture')
    assert.equal(call.headers['x-hzy-app-code'], 'enterprise', 'source_app identity is the caller')
    assert.equal(call.headers['x-hzy-deployment'], 'T1-enterprise')
    const body = JSON.parse(call.body) as Record<string, string>
    assert.equal(body.app_code, 'enterprise')
    assert.equal(body.client_secret, undefined)
    assert.equal(body.scope, 'aims:enterprise-host:execute')
  })

  test('401/403 from the target keep their status (never mapped to 502)', async () => {
    for (const status of [401, 403]) {
      nextStatus = status
      await withEnv(servicesEnv(), async () => {
        await assert.rejects(consoleServiceFetch(event(), 'https://site.example.test/api/x'), (error: { statusCode?: number }) => error.statusCode === status)
        await assert.rejects(serviceAppFetch(null, 'workflow', 'https://site.example.test/workflow/api/x'), (error: { statusCode?: number }) => error.statusCode === status)
      })
    }
    nextStatus = 200
  })

  test('redirects are returned, never followed off the machine', async () => {
    seen.length = 0
    nextStatus = 302
    const response = await createLoopbackServiceBinding(origin).fetch('https://site.example.test/api/x')
    assert.equal(response.status, 302)
    assert.equal(seen.length, 1)
    nextStatus = 200
  })

  test('an unconfigured application fails closed (503) instead of using the public ingress', async () => {
    await withEnv(servicesEnv(), async () => {
      assert.throws(() => selfHostedServiceBinding('finance'), (error: { statusCode?: number }) => error.statusCode === 503)
      await assert.rejects(serviceAppFetch(null, 'finance', 'https://site.example.test/finance/api/x'), (error: { statusCode?: number }) => error.statusCode === 503)
    })
  })

  test('misconfiguration fails closed as 503 without echoing values', () => {
    withEnv({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: JSON.stringify({ console: 'http://10.1.2.3:3000' }) }, () => {
      assert.throws(() => consoleServiceBinding(event()), (error: { statusCode?: number, message?: string }) =>
        error.statusCode === 503 && !String(error.message).includes('10.1.2.3'))
    })
  })

  test('rejects Request inputs and credentialed URLs', async () => {
    const binding = createLoopbackServiceBinding(origin)
    await assert.rejects(binding.fetch(new Request('https://site.example.test/x')))
    await assert.rejects(binding.fetch('https://user:pass@site.example.test/x'))
    await assert.rejects(binding.fetch('file:///etc/passwd'))
  })
})

describe('self-hosted Runtime dial', () => {
  const canonical = 'https://runtime.example.test'
  const runtimeEnv = { HZY_SELF_HOSTED_RUNTIME_ENDPOINT: canonical, HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN: 'http://127.0.0.1:18084' }

  test('replaces only the dial of the configured canonical endpoint', () => {
    withEnv(runtimeEnv, () => {
      assert.equal(resolveSelfHostedRuntimeDialEndpoint(canonical), 'http://127.0.0.1:18084')
      assert.equal(resolveRuntimeDialEndpoint(event(), canonical, true), 'http://127.0.0.1:18084')
      assert.equal(resolveRuntimeDialEndpoint(event(), canonical, false), 'http://127.0.0.1:18084')
      assert.throws(() => resolveRuntimeDialEndpoint(event(), 'https://other.example.test', true), (error: { statusCode?: number }) => error.statusCode === 503)
    })
    withEnv({}, () => assert.equal(resolveRuntimeDialEndpoint(event(), canonical, true), canonical))
  })

  test('the self-hosted dial is never selectable or forwarded by request headers', () => {
    withEnv(runtimeEnv, () => {
      // The hzy0-only header guard is unchanged: a dial header outside hzy0 is refused.
      assert.throws(() => resolveRuntimeDialEndpoint(event({ 'x-hzy-local-runtime-dial-url': 'http://127.0.0.1:18084' }), canonical, true))
      // Downstream forwarding uses the hzy0-only guard, which never returns the self-hosted dial.
      assert.equal(verifiedLocalTestRuntimeDialEndpoint(event(), canonical, true), canonical)
    })
  })
})
