import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requireActiveConsoleServiceToken,
  resolveConsoleServiceTokenIntrospectionFetcher,
  validateIntrospectedServiceTokenClaims
} from '../server/utils/consoleOidc'
import type { H3Event } from 'h3'

test('service token introspection posts the token without putting it in the URL', async () => {
  const calls: Array<{ url: string, body: string, headers: Record<string, string> }> = []
  await requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://console.example.test/',
    token: 'signed-service-token',
    headers: { 'x-hzy-tenant': 'TENANT-A' },
    fetcher: async (url, options) => {
      calls.push({ url, body: options.body, headers: options.headers })
      return { active: true }
    }
  })
  assert.equal(calls[0]?.url, 'https://console.example.test/oauth/introspect')
  assert.equal(calls[0]?.url.includes('signed-service-token'), false)
  assert.equal(new URLSearchParams(calls[0]?.body).get('token'), 'signed-service-token')
  assert.equal(calls[0]?.headers['x-hzy-tenant'], 'TENANT-A')
  assert.equal(calls[0]?.headers['content-type'], 'application/x-www-form-urlencoded')
})

test('Console same-origin introspection stays inside Nitro instead of creating a Worker loop', async () => {
  const calls: Array<{ path: string, body: string, headers: Record<string, string> }> = []
  const event = {
    node: {
      req: {
        headers: {
          'host': 'console.example.test',
          'x-forwarded-host': 'tenant.example.test',
          'x-forwarded-proto': 'https'
        },
        url: '/api/v1/console/service/authorization/subject-eligibility'
      }
    },
    $fetch: async (path: string, options: { body: string, headers: Record<string, string> }) => {
      calls.push({ path, body: options.body, headers: options.headers })
      return { active: true }
    }
  } as unknown as H3Event

  const fetcher = resolveConsoleServiceTokenIntrospectionFetcher(
    event,
    'https://console.example.test/',
    'console'
  )
  assert.equal(typeof fetcher, 'function')

  await requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://console.example.test',
    token: 'signed-service-token',
    headers: { 'x-hzy-tenant': 'TENANT-A' },
    fetcher
  })

  assert.deepEqual(calls, [{
    path: '/oauth/introspect',
    body: 'token=signed-service-token',
    headers: {
      'x-hzy-tenant': 'TENANT-A',
      'content-type': 'application/x-www-form-urlencoded'
    }
  }])
})

test('cross-origin introspection falls back to the external Console boundary without a service binding', () => {
  const event = {
    node: {
      req: {
        headers: { host: 'workflow.example.test' },
        url: '/workflow/api/v1/tasks/100/reject'
      }
    },
    $fetch: async () => ({ active: true })
  } as unknown as H3Event

  assert.equal(resolveConsoleServiceTokenIntrospectionFetcher(
    event,
    'https://console.example.test',
    'workflow'
  ), undefined)
})

test('managed-cloud app introspection uses the Console service binding', async () => {
  const calls: Array<{ url: string, body: string, headers: Headers }> = []
  const event = {
    node: {
      req: {
        headers: { host: 'aims.example.test' },
        url: '/aims/api/v1/service/workflow/callback'
      }
    },
    context: {
      cloudflare: {
        env: {
          HZY_CONSOLE_SERVICE: {
            async fetch(input: string | URL | Request, init: RequestInit = {}) {
              calls.push({
                url: String(input),
                body: String(init.body || ''),
                headers: new Headers(init.headers)
              })
              return Response.json({ active: true })
            }
          }
        }
      }
    }
  } as unknown as H3Event

  const fetcher = resolveConsoleServiceTokenIntrospectionFetcher(
    event,
    'https://tenant.example.test/console',
    'aims'
  )
  assert.equal(typeof fetcher, 'function')

  await requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://tenant.example.test/console',
    token: 'signed-service-token',
    headers: { 'x-hzy-tenant': 'C000001' },
    fetcher
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://tenant.example.test/oauth/introspect')
  assert.equal(calls[0]?.body, 'token=signed-service-token')
  assert.equal(calls[0]?.headers.get('x-hzy-tenant'), 'C000001')
  assert.equal(calls[0]?.headers.get('content-type'), 'application/x-www-form-urlencoded')
  assert.equal(calls[0]?.url.includes('signed-service-token'), false)
})

test('Console service binding failures remain retryable introspection outages', async () => {
  const event = {
    context: {
      cloudflare: {
        env: {
          HZY_CONSOLE_SERVICE: {
            async fetch() {
              return Response.json({ message: 'temporarily unavailable' }, { status: 503 })
            }
          }
        }
      }
    }
  } as unknown as H3Event
  const fetcher = resolveConsoleServiceTokenIntrospectionFetcher(
    event,
    'https://console.example.test',
    'aims'
  )

  await assert.rejects(() => requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://console.example.test',
    token: 'signed-service-token',
    fetcher
  }), (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, 503)
    assert.match(String((error as Error).message), /introspection_unavailable/)
    return true
  })
})

test('service token introspection distinguishes revoked credentials from temporary Console failure', async () => {
  await assert.rejects(() => requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://console.example.test',
    token: 'revoked-token',
    fetcher: async () => ({ active: false })
  }), (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, 401)
    assert.match(String((error as Error).message), /revoked/)
    return true
  })

  await assert.rejects(() => requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://console.example.test',
    token: 'unknown-token',
    fetcher: async () => { throw new Error('console unavailable') }
  }), (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, 503)
    assert.match(String((error as Error).message), /introspection_unavailable/)
    return true
  })

  await assert.rejects(() => requireActiveConsoleServiceToken({
    endpointBaseUrl: 'https://console.example.test',
    token: 'unknown-token',
    fetcher: async () => { throw { statusCode: 500 } }
  }), (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, 503)
    return true
  })
})

test('service token introspection logs nested HTTP failure diagnostics without token data', async () => {
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    await assert.rejects(() => requireActiveConsoleServiceToken({
      endpointBaseUrl: 'https://console.example.test',
      token: 'never-log-this-service-token',
      fetcher: async () => {
        throw {
          message: '[POST] introspection failed',
          response: {
            status: 503,
            statusText: 'Service Unavailable',
            _data: { code: 'control_plane_unavailable', message: 'database temporarily unavailable' }
          }
        }
      }
    }), (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 503)
      return true
    })
  } finally {
    console.warn = originalWarn
  }

  assert.deepEqual(warnings, [[
    '[console-auth] service token introspection request failed',
    {
      statusCode: 503,
      statusText: 'Service Unavailable',
      code: 'control_plane_unavailable',
      summary: 'database temporarily unavailable'
    }
  ]])
  assert.equal(JSON.stringify(warnings).includes('never-log-this-service-token'), false)
})

test('claims are consumed only with exact issuer, audience, token use, and expiry after introspection', () => {
  const claims = {
    iss: 'https://tenant.example.test',
    aud: 'workflow',
    token_use: 'service',
    exp: 2_000
  }

  assert.doesNotThrow(() => validateIntrospectedServiceTokenClaims({
    claims,
    issuers: ['https://tenant.example.test/'],
    audience: 'workflow',
    nowSeconds: 1_000
  }))

  for (const invalidClaims of [
    { ...claims, iss: 'https://attacker.example.test' },
    { ...claims, aud: 'finance' },
    { ...claims, token_use: 'access' },
    { ...claims, exp: 1_000 }
  ]) {
    assert.throws(() => validateIntrospectedServiceTokenClaims({
      claims: invalidClaims,
      issuers: ['https://tenant.example.test'],
      audience: 'workflow',
      nowSeconds: 1_000
    }), /claims are invalid/)
  }
})
