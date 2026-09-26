import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import tenantGateway from '../src/index.js'

function captureFetch(t) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const request = input instanceof Request
      ? input
      : new Request(input, init.body ? { ...init, duplex: 'half' } : init)
    calls.push(request)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  return calls
}

describe('tenant gateway routing and trusted context', () => {
  test('Console receives only a short-lived Platform bootstrap token when registry omits a static token', async (t) => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const request = input instanceof Request ? input : new Request(input, init)
      calls.push(request)
      const url = new URL(request.url)
      if (url.pathname === '/api/resolve') {
        return Response.json({
          data: {
            tenantCode: 'bootstrap-tenant',
            environment: 'prod',
            deploymentCode: 'bootstrap-tenant-console',
            dataRuntime: {
              endpoint: 'https://runtime.example.test',
              runtimeCode: 'bootstrap-runtime',
              audience: 'data-runtime'
            },
            apps: {
              console: {
                deploymentCode: 'bootstrap-tenant-console',
                dataRuntime: { endpoint: 'https://runtime.example.test' }
              }
            }
          }
        })
      }
      if (url.pathname === '/api/runtime-bootstrap-token') {
        return Response.json({
          data: {
            token: 'short-lived-platform-bootstrap',
            expiresAt: new Date(Date.now() + 90_000).toISOString()
          }
        })
      }
      return Response.json({ ok: true })
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    const response = await tenantGateway.fetch(
      new Request('https://bootstrap-tenant.huizhi.yun/api/auth/login-config'),
      {
        HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve',
        HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test'
      }
    )

    assert.equal(response.status, 200)
    assert.equal(calls.length, 3)
    assert.equal(new URL(calls[1].url).pathname, '/api/runtime-bootstrap-token')
    assert.equal(calls[1].headers.get('authorization'), 'Bearer gateway-secret')
    assert.deepEqual(await calls[1].clone().json(), {
      tenantCode: 'bootstrap-tenant',
      environment: 'prod',
      appCode: 'console'
    })
    assert.equal(calls[2].headers.get('x-hzy-data-runtime-token'), 'short-lived-platform-bootstrap')
    assert.equal(calls[2].headers.get('x-hzy-data-runtime-url'), 'https://runtime.example.test')
  })

  test('People route replaces spoofed internal headers with registry context', async (t) => {
    const calls = captureFetch(t)
    const env = {
      HZY_ALLOWED_TENANTS: 'acme',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_PEOPLE_ORIGIN: 'https://people-worker.example.test',
      HZY_ASSETS_ORIGIN: 'https://assets-worker.example.test',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({
        domains: { 'acme.huizhi.yun': 'acme' },
        tenants: {
          acme: {
            tenantCode: 'acme',
            deploymentCode: 'dep-default',
            environment: 'staging',
            apps: {
              people: {
                deploymentCode: 'dep-people',
                dataRuntime: {
                  endpoint: 'https://runtime.example.test',
                  runtimeCode: 'acme-prod-tenant-runtime',
                  staticToken: 'runtime-secret',
                  audience: 'data-runtime'
                }
              },
              assets: {
                deploymentCode: 'dep-assets',
                basePath: '/assets'
              }
            }
          }
        }
      })
    }
    const request = new Request('https://acme.huizhi.yun/people/api/v1/employees', {
      headers: {
        authorization: 'Bearer user-session',
        'x-hzy-gateway': 'attacker',
        'x-hzy-gateway-token': 'spoofed',
        'x-hzy-tenant': 'other-tenant',
        'x-hzy-deployment': 'other-deployment',
        'x-hzy-environment': 'prod',
        'x-hzy-service-routes': '{"assets":{"origin":"https://attacker.example.test"}}',
        'x-hzy-data-runtime-url': 'https://attacker.example.test',
        'x-hzy-data-runtime-code': 'attacker-runtime',
        'x-hzy-data-runtime-token': 'stolen',
        'x-hzy-runtime-bootstrap-unavailable': 'platform'
      }
    })

    const response = await tenantGateway.fetch(request, env)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://people-worker.example.test/people/api/v1/employees')
    assert.equal(calls[0].headers.get('authorization'), 'Bearer user-session')
    assert.equal(calls[0].headers.get('x-hzy-gateway'), 'tenant-gateway')
    assert.equal(calls[0].headers.get('x-hzy-gateway-token'), 'gateway-secret')
    assert.equal(calls[0].headers.get('x-hzy-tenant'), 'acme')
    assert.equal(calls[0].headers.get('x-hzy-app-code'), 'people')
    assert.equal(calls[0].headers.get('x-hzy-deployment'), 'dep-people')
    assert.equal(calls[0].headers.get('x-hzy-environment'), 'staging')
    assert.equal(calls[0].headers.get('x-hzy-data-runtime-url'), 'https://runtime.example.test')
    assert.equal(calls[0].headers.get('x-hzy-data-runtime-code'), 'acme-prod-tenant-runtime')
    assert.equal(calls[0].headers.get('x-hzy-data-runtime-token'), 'runtime-secret')
    assert.equal(calls[0].headers.get('x-hzy-data-runtime-audience'), 'data-runtime')
    assert.equal(calls[0].headers.has('x-hzy-runtime-bootstrap-unavailable'), false, 'a caller cannot claim a Platform outage')
    assert.deepEqual(JSON.parse(calls[0].headers.get('x-hzy-service-routes')), {
      people: {
        origin: 'https://people-worker.example.test',
        deploymentCode: 'dep-people',
        basePath: '/people/'
      },
      assets: {
        origin: 'https://assets-worker.example.test',
        deploymentCode: 'dep-assets',
        basePath: '/assets/'
      }
    })
  })

  test('trusted service-token requests preserve an exact source app binding', async (t) => {
    const calls = captureFetch(t)
    const env = {
      HZY_ALLOWED_TENANTS: 'acme',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({
        domains: { 'acme.huizhi.yun': 'acme' },
        tenants: {
          acme: {
            tenantCode: 'acme',
            deploymentCode: 'acme-console',
            environment: 'prod',
            apps: {
              console: { deploymentCode: 'acme-console' },
              people: { deploymentCode: 'acme-people' }
            }
          }
        }
      })
    }
    const body = JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'people.runtime',
      app_code: 'people',
      audience: 'data-runtime'
    })

    await tenantGateway.fetch(new Request('https://acme.huizhi.yun/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hzy-gateway': 'tenant-gateway',
        'x-hzy-gateway-token': 'gateway-secret',
        'x-hzy-tenant': 'acme',
        'x-hzy-deployment': 'acme-people',
        'x-hzy-environment': 'prod',
        'x-hzy-app-code': 'people'
      },
      body
    }), env)

    await tenantGateway.fetch(new Request('https://acme.huizhi.yun/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hzy-gateway': 'tenant-gateway',
        'x-hzy-gateway-token': 'wrong-token',
        'x-hzy-tenant': 'acme',
        'x-hzy-deployment': 'acme-people',
        'x-hzy-environment': 'prod',
        'x-hzy-app-code': 'people'
      },
      body
    }), env)

    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, 'https://console-worker.example.test/oauth/token')
    assert.equal(calls[0].headers.get('x-hzy-app-code'), 'people')
    assert.equal(calls[0].headers.get('x-hzy-deployment'), 'acme-people')
    assert.equal(calls[1].headers.get('x-hzy-app-code'), 'console')
    assert.equal(calls[1].headers.get('x-hzy-deployment'), 'acme-console')
  })

  test('business application APIs receive the short-lived Console Runtime bootstrap token', async (t) => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const request = input instanceof Request ? input : new Request(input, init)
      calls.push(request)
      const url = new URL(request.url)
      if (url.pathname === '/api/resolve') {
        return Response.json({
          data: {
            tenantCode: 'acme',
            environment: 'prod',
            deploymentCode: 'acme-console',
            dataRuntime: {
              endpoint: 'https://runtime.example.test',
              runtimeCode: 'acme-prod-tenant-runtime',
              audience: 'data-runtime'
            },
            apps: {
              console: {
                deploymentCode: 'acme-console',
                dataRuntime: { endpoint: 'https://runtime.example.test' }
              },
              finance: {
                deploymentCode: 'acme-finance',
                dataRuntime: { endpoint: 'https://runtime.example.test' }
              }
            }
          }
        })
      }
      if (url.pathname === '/api/runtime-bootstrap-token') {
        return Response.json({
          data: {
            token: 'short-lived-platform-bootstrap',
            expiresAt: new Date(Date.now() + 90_000).toISOString()
          }
        })
      }
      return Response.json({ ok: true })
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    const response = await tenantGateway.fetch(
      new Request('https://acme.huizhi.yun/finance/api/auth/oidc-callback', {
        headers: { 'x-hzy-data-runtime-token': 'spoofed-token' }
      }),
      {
        HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve',
        HZY_FINANCE_ORIGIN: 'https://finance-worker.example.test'
      }
    )

    assert.equal(response.status, 200)
    assert.equal(calls.length, 3)
    assert.equal(new URL(calls[1].url).pathname, '/api/runtime-bootstrap-token')
    assert.equal(calls[2].url, 'https://finance-worker.example.test/finance/api/auth/oidc-callback')
    assert.equal(calls[2].headers.get('x-hzy-app-code'), 'finance')
    assert.equal(calls[2].headers.get('x-hzy-deployment'), 'acme-finance')
    assert.equal(calls[2].headers.get('x-hzy-data-runtime-token'), 'short-lived-platform-bootstrap')
  })

  test('bound business apps are dispatched directly without a public custom-domain round trip', async (t) => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error('public app origin must not be called when a Service Binding exists')
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    const calls = []
    const env = {
      HZY_ALLOWED_TENANTS: 'acme',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_AIMS_ORIGIN: 'https://aims.huizhi.yun',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({
        domains: { 'acme.huizhi.yun': 'acme' },
        tenants: {
          acme: {
            tenantCode: 'acme',
            deploymentCode: 'acme-console',
            environment: 'prod',
            dataRuntime: {
              endpoint: 'https://runtime.example.test',
              runtimeCode: 'acme-prod-tenant-runtime',
              staticToken: 'runtime-secret'
            },
            apps: {
              console: { deploymentCode: 'acme-console' },
              aims: { deploymentCode: 'acme-aims' }
            }
          }
        }
      }),
      HZY_AIMS_SERVICE: {
        async fetch(input, init = {}) {
          const request = input instanceof Request
            ? input
            : new Request(input, init.body ? { ...init, duplex: 'half' } : init)
          calls.push(request)
          return Response.json({ ok: true })
        }
      }
    }

    const response = await tenantGateway.fetch(new Request(
      'https://acme.huizhi.yun/aims/api/v1/service/workflow/callback',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer workflow-service-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ status: 'approved' })
      }
    ), env)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://aims.huizhi.yun/aims/api/v1/service/workflow/callback')
    assert.equal(calls[0].headers.get('authorization'), 'Bearer workflow-service-token')
    assert.equal(calls[0].headers.get('x-hzy-app-code'), 'aims')
    assert.equal(calls[0].headers.get('x-hzy-deployment'), 'acme-aims')
    assert.equal(calls[0].headers.get('x-hzy-data-runtime-token'), 'runtime-secret')
    assert.deepEqual(await calls[0].clone().json(), { status: 'approved' })
  })

  test('business app auth callbacks use the ready Console runtime without bypassing the app schema gate', async (t) => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const request = input instanceof Request ? input : new Request(input, init)
      calls.push(request)
      const url = new URL(request.url)
      if (url.pathname === '/api/resolve') {
        return Response.json({
          data: {
            tenantCode: 'schema-gate',
            environment: 'prod',
            deploymentCode: 'schema-gate-console',
            dataRuntime: {
              runtimeCode: 'schema-gate-prod-tenant-runtime',
              audience: 'data-runtime'
            },
            apps: {
              console: {
                deploymentCode: 'schema-gate-console',
                dataRuntime: { endpoint: 'https://runtime.example.test' }
              },
              aims: {
                deploymentCode: 'schema-gate-aims'
              }
            }
          }
        })
      }
      if (url.pathname === '/api/runtime-bootstrap-token') {
        return Response.json({
          data: {
            token: 'short-lived-platform-bootstrap',
            expiresAt: new Date(Date.now() + 90_000).toISOString()
          }
        })
      }
      return Response.json({ ok: true })
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    const env = {
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve',
      HZY_AIMS_ORIGIN: 'https://aims-worker.example.test'
    }

    await tenantGateway.fetch(
      new Request('https://schema-gate.huizhi.yun/aims/api/auth/oidc-callback'),
      env
    )
    await tenantGateway.fetch(
      new Request('https://schema-gate.huizhi.yun/aims/api/v1/admin/projects'),
      env
    )

    const callback = calls.find(call => new URL(call.url).pathname === '/aims/api/auth/oidc-callback')
    const projects = calls.find(call => new URL(call.url).pathname === '/aims/api/v1/admin/projects')
    assert.ok(callback)
    assert.ok(projects)
    assert.equal(callback.headers.get('x-hzy-data-runtime-url'), 'https://runtime.example.test')
    assert.equal(callback.headers.get('x-hzy-data-runtime-token'), 'short-lived-platform-bootstrap')
    assert.equal(projects.headers.get('x-hzy-data-runtime-url'), null)
  })

  test('reserved app hosts strip untrusted internal forwarding headers', async (t) => {
    const calls = captureFetch(t)
    const request = new Request('https://people.huizhi.yun/api/health', {
      headers: {
        'x-request-id': 'request-1',
        'x-hzy-gateway': 'tenant-gateway',
        'x-hzy-gateway-token': 'wrong-token',
        'x-hzy-tenant': 'spoofed-tenant',
        'x-hzy-deployment': 'spoofed-deployment',
        'x-hzy-environment': 'spoofed-environment',
        'x-hzy-service-routes': '{"assets":{"origin":"https://attacker.example.test"}}',
        'x-hzy-data-runtime-token': 'spoofed-runtime-token'
      }
    })

    const response = await tenantGateway.fetch(request, {
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret'
    })

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].headers.get('x-request-id'), 'request-1')
    assert.equal(calls[0].headers.get('x-hzy-gateway'), null)
    assert.equal(calls[0].headers.get('x-hzy-gateway-token'), null)
    assert.equal(calls[0].headers.get('x-hzy-tenant'), null)
    assert.equal(calls[0].headers.get('x-hzy-deployment'), null)
    assert.equal(calls[0].headers.get('x-hzy-environment'), null)
    assert.equal(calls[0].headers.get('x-hzy-service-routes'), null)
    assert.equal(calls[0].headers.get('x-hzy-data-runtime-token'), null)
  })

  test('Console route injects the default and explicit enabled login providers from trusted registry context', async (t) => {
    const calls = captureFetch(t)
    const env = {
      HZY_ALLOWED_TENANTS: 'acme',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({
        domains: { 'acme.huizhi.yun': 'acme' },
        tenants: {
          acme: {
            tenantCode: 'acme',
            deploymentCode: 'acme-console',
            environment: 'prod',
            login: {
              mode: 'oidc',
              enabledProviders: ['oidc', 'wecom'],
              oidc: {
                displayName: '集团身份登录',
                issuer: 'https://idp.example.test/realms/acme',
                clientId: 'console-client'
              },
              wecom: {
                corpid: 'corp-id',
                agentid: '1000007'
              }
            }
          }
        }
      })
    }
    const request = new Request('https://acme.huizhi.yun/login', {
      headers: {
        'x-hzy-console-login-mode': 'dingtalk',
        'x-hzy-console-login-providers': 'dingtalk',
        'x-hzy-dingtalk-client-id': 'attacker'
      }
    })

    const response = await tenantGateway.fetch(request, env)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].headers.get('x-hzy-console-login-mode'), 'oidc')
    assert.equal(calls[0].headers.get('x-hzy-console-login-providers'), 'oidc,wecom')
    assert.equal(
      decodeURIComponent(calls[0].headers.get('x-hzy-sso-oidc-display-name')),
      '集团身份登录'
    )
    assert.equal(calls[0].headers.get('x-hzy-sso-oidc-client-id'), 'console-client')
    assert.equal(calls[0].headers.get('x-hzy-wecom-corpid'), 'corp-id')
    assert.equal(calls[0].headers.get('x-hzy-wecom-agentid'), '1000007')
    assert.equal(calls[0].headers.get('x-hzy-dingtalk-client-id'), null)
  })

  test('Directory Connector route binds Console requests to the connector source identity', async (t) => {
    const calls = captureFetch(t)
    const env = {
      HZY_ALLOWED_TENANTS: 'C000001',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({
        domains: { 'acme.huizhi.yun': 'C000001' },
        tenants: {
          C000001: {
            tenantCode: 'C000001',
            deploymentCode: 'C000001-console',
            environment: 'prod'
          }
        }
      })
    }
    const request = new Request('https://acme.huizhi.yun/directory-connector/oauth/token', {
      method: 'POST',
      headers: {
        cookie: 'must-not-forward=1',
        'content-type': 'application/x-www-form-urlencoded',
        'x-hzy-app-code': 'attacker',
        'x-hzy-tenant': 'other-tenant'
      },
      body: 'grant_type=client_credentials'
    })

    const response = await tenantGateway.fetch(request, env)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://console-worker.example.test/oauth/token')
    assert.equal(calls[0].headers.get('cookie'), null)
    assert.equal(calls[0].headers.get('x-hzy-gateway'), 'tenant-gateway')
    assert.equal(calls[0].headers.get('x-hzy-gateway-token'), 'gateway-secret')
    assert.equal(calls[0].headers.get('x-hzy-tenant'), 'C000001')
    assert.equal(calls[0].headers.get('x-hzy-deployment'), 'C000001-console')
    assert.equal(calls[0].headers.get('x-hzy-app-code'), 'directory-connector')
    assert.equal(calls[0].headers.get('x-forwarded-prefix'), '/directory-connector')
  })

  test('Directory Connector enrollment receives a short-lived Runtime bootstrap token', async (t) => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      const request = input instanceof Request
        ? input
        : new Request(input, init.body ? { ...init, duplex: 'half' } : init)
      calls.push(request)
      const url = new URL(request.url)
      if (url.pathname === '/api/resolve') {
        return Response.json({
          data: {
            tenantCode: 'C000001',
            environment: 'prod',
            deploymentCode: 'C000001-console',
            dataRuntime: {
              endpoint: 'https://runtime.example.test',
              runtimeCode: 'c000001-prod-tenant-runtime',
              audience: 'data-runtime'
            },
            apps: {
              console: {
                deploymentCode: 'C000001-console',
                dataRuntime: { endpoint: 'https://runtime.example.test' }
              }
            }
          }
        })
      }
      if (url.pathname === '/api/runtime-bootstrap-token') {
        return Response.json({
          data: {
            token: 'short-lived-platform-bootstrap',
            expiresAt: new Date(Date.now() + 90_000).toISOString()
          }
        })
      }
      return Response.json({ ok: true })
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    const response = await tenantGateway.fetch(
      new Request('https://connector-enroll.huizhi.yun/directory-connector/api/v1/console/directory-connectors/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enrollmentToken: 'signed-token' })
      }),
      {
        HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://enrollment-platform.example.test/api/resolve',
        HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test'
      }
    )

    assert.equal(response.status, 200)
    assert.equal(calls.length, 3)
    assert.equal(new URL(calls[1].url).pathname, '/api/runtime-bootstrap-token')
    assert.equal(calls[2].url, 'https://console-worker.example.test/api/v1/console/directory-connectors/enroll')
    assert.equal(calls[2].headers.get('x-hzy-data-runtime-token'), 'short-lived-platform-bootstrap')
    assert.equal(calls[2].headers.get('x-hzy-data-runtime-url'), 'https://runtime.example.test')
    assert.equal(calls[2].headers.get('x-hzy-app-code'), 'directory-connector')
  })

  test('Directory Connector prefix does not expose arbitrary Console routes', async (t) => {
    const calls = captureFetch(t)
    const env = {
      HZY_ALLOWED_TENANTS: 'C000001',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: 'gateway-secret',
      HZY_CONSOLE_ORIGIN: 'https://console-worker.example.test',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({
        domains: { 'acme.huizhi.yun': 'C000001' },
        tenants: { C000001: { tenantCode: 'C000001', deploymentCode: 'C000001-console' } }
      })
    }

    await tenantGateway.fetch(new Request('https://acme.huizhi.yun/directory-connector/api/auth/me'), env)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://console-worker.example.test/directory-connector/api/auth/me')
    assert.equal(calls[0].headers.get('x-hzy-app-code'), 'console')
  })
})
