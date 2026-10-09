import { after, afterEach, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLoopbackServiceBinding, isSelfHostedLoopbackBinding } from '../server/utils/selfHostedServiceTransport.ts'
import { consoleServiceBinding, consoleServiceFetch, normalizeConsoleServiceBindingUrl } from '../server/utils/consoleServiceBinding.ts'
import { getConsoleRuntimeConfig } from '../server/utils/consoleRuntime.ts'
import { resolveConsoleServiceTokenIntrospectionFetcher } from '../server/utils/consoleOidc.ts'
import { fetchConsoleServiceJson, requestServiceAccessToken } from '../server/utils/serviceOidc.ts'

/**
 * The self-hosted Console serves under NUXT_APP_BASE_URL=/console/ and answers an unprefixed path with a 302.
 * The loopback transport never follows redirects, so every server-to-server call to Console must keep /console when
 * (and only when) the binding is the self-hosted loopback transport. A real Cloudflare Service Binding keeps
 * stripping it (the Console Worker's base path is /). The decision comes from the binding object, never from input.
 */

const PUBLIC = 'https://site.example.test/console'
const globals = globalThis as { useRuntimeConfig?: unknown, $fetch?: unknown }
const originalConfig = globals.useRuntimeConfig
const originalFetch = globals.$fetch
const ENV_NAME = 'HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON'
const previousEnv = process.env[ENV_NAME]

type Hit = { method: string, url: string }
const hits: Hit[] = []
let server: Server
let origin = ''

before(async () => {
  server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      hits.push({ method: req.method || '', url: req.url || '' })
      // Mirrors the real Console (base /console/): unprefixed paths redirect, prefixed ones are served.
      if (!(req.url || '').startsWith('/console/')) {
        res.writeHead(302, { location: `/console${req.url}` }).end()
        return
      }
      const path = (req.url || '').split('?')[0]
      res.writeHead(200, { 'content-type': 'application/json' })
      if (path.endsWith('/oauth/token')) res.end(JSON.stringify({ access_token: 'prefixed-token', token_type: 'Bearer', expires_in: 300 }))
      else if (path.endsWith('/oauth/introspect')) res.end(JSON.stringify({ active: true }))
      else if (path.includes('/runtime/apps/')) {
        res.end(JSON.stringify({ code: 0, data: { schemaVersion: 'console-runtime.v1', app: { appCode: 'x', appName: 'x' },
          console: { baseUrl: PUBLIC, issuer: PUBLIC, tokenUrl: `${PUBLIC}/oauth/token`, bootstrapTokenUrl: `${PUBLIC}/api/v1/console/bootstrap/token`,
            authMeUrl: `${PUBLIC}/api/v1/console/auth/me`, directoryApiUrl: `${PUBLIC}/api/v1/console/directory`, settingsApiUrl: `${PUBLIC}/api/v1/console/settings`,
            integrationsApiUrl: `${PUBLIC}/api/v1/console/integrations`, userApplicationsUrl: `${PUBLIC}/api/user/applications` }, fetchedAt: '2026-09-30T00:00:00.000Z' } }))
      } else res.end(JSON.stringify({ code: 0, data: { ok: true } }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => new Promise<void>(resolve => server.close(() => resolve())))
afterEach(() => {
  globals.useRuntimeConfig = originalConfig
  globals.$fetch = originalFetch
  if (previousEnv === undefined) Reflect.deleteProperty(process.env, ENV_NAME)
  else process.env[ENV_NAME] = previousEnv
  hits.length = 0
})

const selfHosted = () => {
  process.env[ENV_NAME] = JSON.stringify({ console: origin })
}
const event = (env: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  ({ context: { cloudflare: { env } }, node: { req: { headers } }, path: '/', method: 'GET' }) as never

function cloudflareBinding(calls: string[]) {
  return { fetch: async (input: string | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ code: 0, active: true, access_token: 'cf', data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } })
  } }
}

describe('Console prefix handling depends on the transport type only', () => {
  test('normalize: Cloudflare (or no) binding strips /console; the self-hosted loopback binding keeps it', () => {
    const loopback = createLoopbackServiceBinding(origin)
    const cloudflare = cloudflareBinding([])
    assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}/api/x?a=1`), 'https://site.example.test/api/x?a=1', 'no binding: unchanged legacy behaviour')
    assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}/api/x?a=1`, cloudflare), 'https://site.example.test/api/x?a=1')
    assert.equal(normalizeConsoleServiceBindingUrl(PUBLIC, cloudflare), 'https://site.example.test/')
    assert.equal(normalizeConsoleServiceBindingUrl(new URL(`${PUBLIC}/oauth/token`), cloudflare), 'https://site.example.test/oauth/token')
    assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}/api/x?a=1`, loopback), `${PUBLIC}/api/x?a=1`)
    assert.equal(normalizeConsoleServiceBindingUrl(PUBLIC, loopback), PUBLIC)
    assert.equal(normalizeConsoleServiceBindingUrl('https://site.example.test/api/x', loopback), 'https://site.example.test/console/api/x')
  })

  test('unprefixed notifications/token/introspection are prefixed once only on self-hosted transport', async () => {
    selfHosted()
    const root = 'https://site.example.test'
    for (const path of ['/api/v1/console/notifications/publish', '/oauth/token', '/oauth/introspect']) {
      await fetchConsoleServiceJson(event(), `${root}${path}?probe=1`, { method: 'POST', body: {} })
      await fetchConsoleServiceJson(event(), `${PUBLIC}${path}?probe=1`, { method: 'POST', body: {} })
    }
    assert.deepEqual(hits.map(hit => hit.url), [
      '/console/api/v1/console/notifications/publish?probe=1', '/console/api/v1/console/notifications/publish?probe=1',
      '/console/oauth/token?probe=1', '/console/oauth/token?probe=1', '/console/oauth/introspect?probe=1', '/console/oauth/introspect?probe=1'
    ])
    const calls: string[] = []
    const cf = cloudflareBinding(calls)
    for (const path of ['/api/v1/console/notifications/publish', '/oauth/token', '/oauth/introspect']) {
      assert.equal(normalizeConsoleServiceBindingUrl(`${root}${path}`, cf), `${root}${path}`)
      assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}${path}`, cf), `${root}${path}`)
    }
    const previous = process.env.HZY0_LOCAL_ENTERPRISE
    try {
      process.env.HZY0_LOCAL_ENTERPRISE = 'true'
      const local = { fetch: cf.fetch }
      const localEvent = { context: { hzyConsoleTransport: local }, node: { req: { headers: { 'x-hzy-self-hosted': 'true' } } } } as never
      assert.equal(consoleServiceBinding(localEvent), local)
      assert.equal(normalizeConsoleServiceBindingUrl(`${root}/oauth/token`, local), `${root}/oauth/token`)
      assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}/oauth/token`, local), `${root}/oauth/token`)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'HZY0_LOCAL_ENTERPRISE')
      else process.env.HZY0_LOCAL_ENTERPRISE = previous
    }
  })

  test('the loopback marker cannot be forged from request-controlled input or by copying a binding', () => {
    const loopback = createLoopbackServiceBinding(origin)
    const copies: unknown[] = [{ ...loopback }, Object.create(loopback), { fetch: loopback.fetch, hzySelfHostedLoopback: true },
      { fetch: async () => new Response('{}'), transport: 'self-hosted' }, 'self-hosted', null, undefined, 1]
    for (const copy of copies) {
      assert.equal(isSelfHostedLoopbackBinding(copy), false)
      assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}/api/x`, copy), 'https://site.example.test/api/x')
    }
    assert.equal(isSelfHostedLoopbackBinding(loopback), true)
    // URL / header inputs never influence the decision.
    assert.equal(normalizeConsoleServiceBindingUrl(`${PUBLIC}/api/x?transport=self-hosted&binding=loopback`, { fetch: async () => new Response('{}') }),
      'https://site.example.test/api/x?transport=self-hosted&binding=loopback')
  })

  test('consoleServiceBinding(): a real Cloudflare binding wins and is not the loopback transport', () => {
    selfHosted()
    const cf = cloudflareBinding([])
    assert.equal(consoleServiceBinding(event({ HZY_CONSOLE_SERVICE: cf })), cf)
    assert.equal(isSelfHostedLoopbackBinding(consoleServiceBinding(event({ HZY_CONSOLE_SERVICE: cf }))), false)
    assert.equal(isSelfHostedLoopbackBinding(consoleServiceBinding(event())), true)
  })

  test('consoleServiceFetch / fetchConsoleServiceJson: self-hosted keeps /console, Cloudflare strips it', async () => {
    selfHosted()
    await consoleServiceFetch(event(), `${PUBLIC}/api/v1/console/service/x`, { params: { p: 1 } })
    await fetchConsoleServiceJson(event(), new URL(`${PUBLIC}/api/v1/console/settings/values?keys=a`))
    assert.deepEqual(hits.map(hit => hit.url), ['/console/api/v1/console/service/x?p=1', '/console/api/v1/console/settings/values?keys=a'])
    const calls: string[] = []
    const cf = event({ HZY_CONSOLE_SERVICE: cloudflareBinding(calls) })
    await consoleServiceFetch(cf, `${PUBLIC}/api/v1/console/service/x`, { params: { p: 1 } })
    await fetchConsoleServiceJson(cf, new URL(`${PUBLIC}/api/v1/console/settings/values?keys=a`))
    assert.deepEqual(calls, ['https://site.example.test/api/v1/console/service/x?p=1', 'https://site.example.test/api/v1/console/settings/values?keys=a'])
  })

  test('consoleRuntime: reading the Console runtime config gets the business response, not a 302, self-hosted; Cloudflare strips', async () => {
    selfHosted()
    const appCode = `sh-${Date.now()}`
    globals.useRuntimeConfig = () => ({ hzy: { appCode, consoleApiUrl: PUBLIC, consoleRuntimeEnabled: true } })
    globals.$fetch = async () => {
      throw new Error('public fetch must not be used')
    }
    const config = await getConsoleRuntimeConfig({ appCode, event: event() } as never)
    assert.equal(config.console.baseUrl, PUBLIC)
    assert.equal(hits.length, 1)
    assert.ok(hits[0]!.url.startsWith(`/console/api/v1/console/runtime/apps/${appCode}/config`), hits[0]!.url)
    hits.length = 0
    const calls: string[] = []
    const cfApp = `cf-${Date.now()}`
    globals.useRuntimeConfig = () => ({ hzy: { appCode: cfApp, consoleApiUrl: PUBLIC, consoleRuntimeEnabled: true } })
    await getConsoleRuntimeConfig({ appCode: cfApp, event: event({ HZY_CONSOLE_SERVICE: cloudflareBinding(calls) }) } as never)
    assert.equal(calls.length, 1)
    assert.ok(calls[0]!.startsWith(`https://site.example.test/api/v1/console/runtime/apps/${cfApp}/config`), calls[0])
    assert.equal(hits.length, 0)
  })

  test('service-token introspection dials the local Console with the prefix; Cloudflare strips', async () => {
    selfHosted()
    const fetcher = resolveConsoleServiceTokenIntrospectionFetcher(event(), PUBLIC, 'codocs')
    assert.ok(fetcher)
    const result = await fetcher!(`${PUBLIC}/oauth/introspect`, { method: 'POST', body: 'token=t' } as never)
    assert.equal((result as { active?: boolean }).active, true)
    assert.deepEqual(hits.map(hit => hit.url), ['/console/oauth/introspect'])
    const calls: string[] = []
    const cf = resolveConsoleServiceTokenIntrospectionFetcher(event({ HZY_CONSOLE_SERVICE: cloudflareBinding(calls) }), PUBLIC, 'codocs')
    await cf!(`${PUBLIC}/oauth/introspect`, { method: 'POST', body: 'token=t' } as never)
    assert.deepEqual(calls, ['https://site.example.test/oauth/introspect'])
  })

  test('service token request: the app gets a token from the local Console /console/oauth/token (placeholder-free path check)', async () => {
    selfHosted()
    globals.useRuntimeConfig = () => ({ hzy: { appCode: 'aims', cloudflareInternalToken: 'gateway-fixture', consoleApiUrl: PUBLIC, consoleTokenUrl: `${PUBLIC}/oauth/token`,
      serviceClient: { clientId: 'aims.runtime', clientSecret: 'x', tokenUrl: `${PUBLIC}/oauth/token` } } })
    globals.$fetch = async () => {
      throw new Error('public fetch must not be used')
    }
    const token = await requestServiceAccessToken({ audience: 'workflow', scope: 'workflow:x:y', event: event() })
    assert.equal(token, 'prefixed-token')
    assert.ok(hits.some(hit => hit.method === 'POST' && hit.url === '/console/oauth/token'), JSON.stringify(hits))
  })
})
