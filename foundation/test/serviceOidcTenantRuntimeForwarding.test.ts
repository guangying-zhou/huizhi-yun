import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'
import {
  fetchConsoleServiceJson,
  requestServiceAccessToken,
  setLocalServiceTokenIssuer,
  trustedServiceRequestHeaders
} from '../server/utils/serviceOidc.ts'
import { resolveServiceAppBaseUrl } from '../server/utils/serviceAppUrl.ts'

const originalFetch = (globalThis as { $fetch?: unknown }).$fetch
const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig

afterEach(() => {
  setLocalServiceTokenIssuer(null)
  if (originalFetch === undefined) {
    delete (globalThis as { $fetch?: unknown }).$fetch
  } else {
    ;(globalThis as { $fetch?: unknown }).$fetch = originalFetch
  }
  if (originalRuntimeConfig === undefined) {
    delete (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
  } else {
    ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
  }
})

describe('Console service-token tenant-runtime forwarding', () => {
  test('sends JSON commands through the Console Service Binding when available', async () => {
    const calls: Array<{ url: string, method: string, headers: Record<string, string>, body: Record<string, unknown> }> = []
    const event = {
      context: {
        cloudflare: {
          env: {
            HZY_CONSOLE_SERVICE: {
              async fetch(input: string | URL | Request, init?: RequestInit) {
                calls.push({
                  url: input instanceof Request ? input.url : String(input),
                  method: String(init?.method || 'GET'),
                  headers: Object.fromEntries(new Headers(init?.headers)),
                  body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
                })
                return Response.json({ code: 0, data: { accepted: true } })
              }
            }
          }
        }
      }
    } as never

    const response = await fetchConsoleServiceJson<{ code: number, data: { accepted: boolean } }>(
      event,
      'https://console.huizhi.yun/api/v1/console/service/directory/users/zhaojing/disable',
      {
        method: 'POST',
        headers: { authorization: 'Bearer service-token' },
        body: { serviceCommand: { operationId: 'operation-1' } },
        timeout: 1000
      }
    )

    assert.deepEqual(response, { code: 0, data: { accepted: true } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://console.huizhi.yun/api/v1/console/service/directory/users/zhaojing/disable')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers.authorization, 'Bearer service-token')
    assert.equal(calls[0].headers['content-type'], 'application/json')
    assert.deepEqual(calls[0].body, { serviceCommand: { operationId: 'operation-1' } })
  })

  test('removes the tenant gateway Console prefix before using the Console Service Binding', async () => {
    const calls: string[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            HZY_CONSOLE_SERVICE: {
              async fetch(input: string | URL | Request) {
                calls.push(input instanceof Request ? input.url : String(input))
                return Response.json({ code: 0, data: { accepted: true } })
              }
            }
          }
        }
      }
    } as never

    await fetchConsoleServiceJson(
      event,
      'https://wiztek.huizhi.yun/console/api/v1/console/service/authorization/role-holders?roleCodes=project_director'
    )

    assert.deepEqual(calls, [
      'https://wiztek.huizhi.yun/api/v1/console/service/authorization/role-holders?roleCodes=project_director'
    ])
  })

  test('uses a gateway-authenticated target route and rewrites the downstream app context', () => {
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      hzy: {
        appCode: 'aims',
        cloudflareInternalToken: 'trusted-gateway-token',
        deploymentProfile: 'managed-cloud'
      }
    })
    const event = {
      context: {},
      node: {
        req: {
          headers: {
            'x-hzy-gateway': 'tenant-gateway',
            'x-hzy-gateway-token': 'trusted-gateway-token',
            'x-hzy-tenant': 'C000001',
            'x-hzy-deployment': 'C000001-aims',
            'x-hzy-environment': 'prod',
            'x-hzy-app-code': 'aims',
            'x-forwarded-host': 'wiztek.huizhi.yun',
            'x-forwarded-proto': 'https',
            'x-forwarded-prefix': '/aims',
            'x-hzy-data-runtime-url': 'https://runtime.example.test',
            'x-hzy-data-runtime-code': 'runtime-prod',
            'x-hzy-data-runtime-token': 'runtime-bootstrap-token',
            'x-hzy-data-runtime-audience': 'data-runtime',
            'x-hzy-service-routes': JSON.stringify({
              assets: {
                origin: 'https://assets-worker.example.test',
                deploymentCode: 'C000001-assets',
                basePath: '/assets/'
              }
            })
          },
          url: '/api/v1/product-assets'
        }
      }
    } as never

    assert.equal(
      resolveServiceAppBaseUrl(event, 'assets', { directTarget: true }),
      'https://assets-worker.example.test/assets'
    )
    assert.deepEqual(trustedServiceRequestHeaders(event, 'assets'), {
      'x-hzy-gateway': 'tenant-gateway',
      'x-hzy-gateway-token': 'trusted-gateway-token',
      'x-hzy-tenant': 'C000001',
      'x-hzy-deployment': 'C000001-assets',
      'x-hzy-environment': 'prod',
      'x-hzy-app-code': 'assets',
      'x-forwarded-host': 'wiztek.huizhi.yun',
      'x-forwarded-prefix': '/assets',
      'x-forwarded-proto': 'https',
      'x-hzy-data-runtime-url': 'https://runtime.example.test',
      'x-hzy-data-runtime-code': 'runtime-prod',
      'x-hzy-data-runtime-token': 'runtime-bootstrap-token',
      'x-hzy-data-runtime-audience': 'data-runtime'
    })
  })

  test('rejects a browser-spoofed target route without a valid gateway token', () => {
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      hzy: {
        appCode: 'aims',
        cloudflareInternalToken: 'trusted-gateway-token',
        deploymentProfile: 'managed-cloud'
      }
    })
    const event = {
      context: {},
      node: {
        req: {
          headers: {
            'x-hzy-gateway': 'tenant-gateway',
            'x-hzy-gateway-token': 'wrong-token',
            'x-hzy-service-routes': JSON.stringify({
              assets: {
                origin: 'https://attacker.example.test',
                deploymentCode: 'spoofed',
                basePath: '/assets/'
              }
            })
          },
          url: '/api/v1/product-assets'
        }
      }
    } as never

    assert.equal(resolveServiceAppBaseUrl(event, 'assets', { directTarget: true }), '')
    assert.deepEqual(trustedServiceRequestHeaders(event, 'assets'), {})
  })

  test('forwards Runtime bootstrap headers only from a verified tenant gateway request', async () => {
    const calls: Array<{ url: string, options: Record<string, unknown> }> = []
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      hzy: {
        appCode: 'workflow',
        consoleUrl: 'https://console.example.test',
        cloudflareInternalToken: 'trusted-gateway-token',
        serviceClient: {
          clientId: 'workflow.runtime',
          clientSecret: 'legacy-worker-secret'
        }
      }
    })
    ;(globalThis as { $fetch?: unknown }).$fetch = async () => {
      throw new Error('public Console fetch must not be used when a Service Binding is available')
    }

    const event = {
      context: {
        cloudflare: {
          env: {
            HZY_CONSOLE_SERVICE: {
              async fetch(input: string | URL | Request, init?: RequestInit) {
                const url = input instanceof Request ? input.url : String(input)
                const headers = Object.fromEntries(new Headers(init?.headers))
                const body = JSON.parse(String(init?.body || '{}')) as Record<string, string>
                calls.push({ url, options: { headers, body } })
                return new Response(JSON.stringify({
                  access_token: 'service-access-token',
                  token_type: 'Bearer',
                  expires_in: 900,
                  scope: 'workflow:tasks:read'
                }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' }
                })
              }
            }
          }
        }
      },
      node: {
        req: {
          headers: {
            'x-hzy-gateway': 'tenant-gateway',
            'x-hzy-gateway-token': 'trusted-gateway-token',
            'x-hzy-tenant': 'C000001',
            'x-hzy-deployment': 'C000001-console',
            'x-hzy-environment': 'prod',
            'x-hzy-app-code': 'workflow',
            'x-forwarded-host': 'wiztek.huizhi.yun',
            'x-forwarded-proto': 'https',
            'x-hzy-data-runtime-url': 'https://runtime.example.test',
            'x-hzy-data-runtime-code': 'runtime-prod',
            'x-hzy-data-runtime-token': 'runtime-bootstrap-token',
            'x-hzy-data-runtime-audience': 'data-runtime'
          },
          url: '/api/v1/tasks/pending'
        }
      }
    } as never

    const token = await requestServiceAccessToken({
      audience: 'data-runtime',
      scope: 'data-runtime:workflow:tasks:read',
      event
    })

    assert.equal(token, 'service-access-token')
    const tokenCall = calls.find(call => call.url === 'https://wiztek.huizhi.yun/oauth/token')
    assert.ok(tokenCall)
    const headers = tokenCall.options.headers as Record<string, string>
    const body = tokenCall.options.body as Record<string, string>
    assert.equal(headers['x-hzy-data-runtime-url'], 'https://runtime.example.test')
    assert.equal(headers['x-hzy-data-runtime-code'], 'runtime-prod')
    assert.equal(headers['x-hzy-data-runtime-token'], 'runtime-bootstrap-token')
    assert.equal(headers['x-hzy-data-runtime-audience'], 'data-runtime')
    assert.equal(body.client_id, 'workflow.runtime')
    assert.equal(body.app_code, 'workflow')
    assert.equal(body.client_secret, undefined)
  })

  test('coalesces concurrent cold requests for the same service token', async () => {
    let requests = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      hzy: { appCode: 'aims', consoleUrl: 'https://console.example.test', serviceClient: { clientId: 'aims.runtime', clientSecret: 'test-secret' } }
    })
    const event = {
      context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: {
        async fetch() {
          requests += 1
          await pending
          return Response.json({ access_token: 'coalesced-token', token_type: 'Bearer', expires_in: 900 })
        }
      } } } },
      node: { req: { headers: { 'host': 'aims.example.test', 'x-forwarded-proto': 'https' }, url: '/api/test', originalUrl: '/api/test' } }
    } as never

    const concurrent = Array.from({ length: 100 }, () => requestServiceAccessToken({
      audience: 'data-runtime', scope: 'aims:coalesced:test', event
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(requests, 1)
    release?.()
    assert.deepEqual(await Promise.all(concurrent), Array(100).fill('coalesced-token'))
  })

  test('normalizes scope while isolating tenant, deployment, environment, audience and source binding', async () => {
    let requests = 0
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      hzy: {
        appCode: 'aims', consoleUrl: 'https://console.example.test',
        cloudflareInternalToken: 'fixture-gateway-token',
        serviceClient: { clientId: 'aims.runtime', clientSecret: 'fixture-secret' }
      }
    })
    const eventFor = (tenant: string, deployment: string, environment = 'test') => ({
      context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: {
        async fetch(input: string | URL | Request) {
          const url = input instanceof Request ? input.url : String(input)
          if (!url.endsWith('/oauth/token')) return Response.json({})
          requests++
          return Response.json({ access_token: `token-${requests}`, token_type: 'Bearer', expires_in: 900 })
        }
      } } } },
      node: { req: { headers: {
        'x-hzy-gateway': 'tenant-gateway',
        'x-hzy-gateway-token': 'fixture-gateway-token',
        'x-hzy-tenant': tenant,
        'x-hzy-deployment': deployment,
        'x-hzy-environment': environment,
        'x-hzy-app-code': 'aims',
        'x-forwarded-host': 'fixture.example.test',
        'x-forwarded-proto': 'https'
      }, url: '/api/test' } }
    }) as never
    const event = eventFor('C000001', 'C000001-aims')
    const base = { audience: 'data-runtime', scope: 'aims:one:read aims:two:read', event }
    const first = await requestServiceAccessToken(base)
    assert.equal(await requestServiceAccessToken({ ...base, scope: 'aims:two:read aims:one:read aims:one:read' }), first)
    assert.equal(requests, 1)
    for (const input of [
      { ...base, event: eventFor('C000002', 'C000001-aims') },
      { ...base, event: eventFor('C000001', 'C000002-aims') },
      { ...base, event: eventFor('C000001', 'C000001-aims', 'prod') },
      { ...base, audience: 'tenant-runtime' },
      { ...base, sourceBinding: 'service-client-policy' as const }
    ]) {
      assert.notEqual(await requestServiceAccessToken(input), first)
    }
    assert.equal(requests, 6)
  })

  test('forced refresh bypasses an older flight and keeps the newer token', async () => {
    let requests = 0
    let releaseOld!: () => void
    const oldPending = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      hzy: { appCode: 'aims', consoleUrl: 'https://console.example.test', serviceClient: { clientId: 'aims.runtime', clientSecret: 'fixture-secret' } }
    })
    const event = {
      context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: { async fetch(input: string | URL | Request) {
        const url = input instanceof Request ? input.url : String(input)
        if (!url.endsWith('/oauth/token')) return Response.json({})
        requests++
        const current = requests
        if (current === 1) await oldPending
        return Response.json({ access_token: `token-${current}`, token_type: 'Bearer', expires_in: 900 })
      } } } } },
      node: { req: { headers: { host: 'aims.example.test' }, url: '/api/test', originalUrl: '/api/test' } }
    } as never
    const input = { audience: 'data-runtime', scope: 'aims:refresh:test', event }
    const old = requestServiceAccessToken(input)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(await requestServiceAccessToken({ ...input, forceRefresh: true }), 'token-2')
    releaseOld()
    assert.equal(await old, 'token-1')
    assert.equal(await requestServiceAccessToken(input), 'token-2')
    assert.equal(requests, 2)
  })

  test('local issuer shares the bounded cache and flight without retaining opaque tokens', async () => {
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({ hzy: { appCode: 'console' } })
    let calls = 0
    const jwt = await new SignJWT({ token_use: 'service' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('fixture-secret-fixture-secret-fixture-secret'))
    setLocalServiceTokenIssuer(async () => {
      calls++
      return jwt
    })
    const input = { audience: 'data-runtime', scope: 'console:read', event: { node: { req: { headers: {}, url: '/api/test' } } } as never }
    assert.deepEqual(await Promise.all(Array.from({ length: 100 }, () => requestServiceAccessToken(input))), Array(100).fill(jwt))
    assert.equal(calls, 1)
    assert.equal(await requestServiceAccessToken(input), jwt)
    assert.equal(calls, 1)
    await requestServiceAccessToken({ ...input, forceRefresh: true })
    assert.equal(calls, 2)
    await requestServiceAccessToken({ ...input, deploymentCodeOverride: 'other' })
    assert.equal(calls, 3)
  })

  test('evicts the oldest service token when an isolate reaches its cache limit', async () => {
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({ hzy: { appCode: 'console' } })
    let calls = 0
    const jwt = await new SignJWT({ token_use: 'service' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('fixture-secret-fixture-secret-fixture-secret'))
    setLocalServiceTokenIssuer(async () => {
      calls++
      return jwt
    })
    const event = { node: { req: { headers: {}, url: '/api/test' } } } as never
    for (let index = 0; index < 257; index++) {
      await requestServiceAccessToken({ audience: 'data-runtime', scope: `console:fixture:${index}`, event })
    }
    assert.equal(calls, 257)
    await requestServiceAccessToken({ audience: 'data-runtime', scope: 'console:fixture:256', event })
    assert.equal(calls, 257, 'the newest entry remains cached')
    await requestServiceAccessToken({ audience: 'data-runtime', scope: 'console:fixture:0', event })
    assert.equal(calls, 258, 'the oldest entry was evicted')
  })
})
