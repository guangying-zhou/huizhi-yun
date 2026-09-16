import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
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
})
