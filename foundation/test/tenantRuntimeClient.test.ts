import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import {
  buildServiceCommandRuntimeHeaders,
  hashServiceCommandPayload,
  isPlatformRuntimeBootstrapToken,
  maybeCallTenantRuntime,
  tenantRuntimeTokenScope,
  verifyServiceCommandRuntimeHeaders, verifiedServiceCommandActor
} from '../server/utils/tenantRuntimeClient.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'
import { tenantRuntimeErrorData } from '../server/utils/tenantRuntimeErrors.ts'
import { classifyServiceOperationFailure } from '../server/utils/serviceOperation.ts'

type ServiceCommandHeaders = Record<string, string>

test('verified command actors stay request-local, target-bound and authenticated', async () => {
  const command = { actorUid: 'person-a', actorDeptCodes: ['DEPT-1'] }
  const event = { context: { consoleAuth: { authenticated: true, subjectType: 'service', tokenUse: 'service',
    appCode: 'enterprise', clientCode: 'enterprise.runtime', tenant: 'T', deployment: 'HOST',
    scopes: ['aims:project-documents:write'] } } } as never
  const envelope = { operationId: crypto.randomUUID(), targetApp: 'aims', operationCode: 'enterprise.aims.project-document-writes.create-markdown.v1',
    requiredCapability: 'aims:project-documents:write', idempotencyKey: 'document-1', commandSchemaVersion: 'v1',
    commandSha256: await hashServiceCommandPayload(command), command }
  const input = { token: 'test-token', method: 'POST' as const, requestTarget: '/aims/api/service',
    requestId: 'request-1', tenantCode: 'T', sourceDeploymentCode: 'HOST', targetDeploymentCode: 'AIMS',
    sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope }
  const headers = await buildServiceCommandRuntimeHeaders(input)
  assert.equal(verifiedServiceCommandActor(event, 'aims'), null)
  await assert.rejects(() => verifyServiceCommandRuntimeHeaders({ ...input, event, token: 'wrong', readHeader: name => headers[name] }))
  assert.equal(verifiedServiceCommandActor(event, 'aims'), null)
  await verifyServiceCommandRuntimeHeaders({ ...input, event, readHeader: name => headers[name] })
  assert.deepEqual(verifiedServiceCommandActor(event, 'aims'), { uid: 'person-a', deptCodes: ['DEPT-1'] })
  assert.equal(verifiedServiceCommandActor(event, 'codocs'), null)
  const independent = { context: { ...(event as { context: object }).context } } as never
  assert.equal(verifiedServiceCommandActor(independent, 'aims'), null)
  const auth = (event as { context: { consoleAuth: { scopes: string[] } } }).context.consoleAuth
  auth.scopes = []
  assert.equal(verifiedServiceCommandActor(event, 'aims'), null)
})

describe('tenant runtime token scope', () => {
  test('registered enterprise paths preserve exact business capabilities for both audiences', () => {
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      assert.equal(tenantRuntimeTokenScope(audience, 'assets:product:read', 'business'), 'assets:product:read')
      for (const invalid of ['', '*', 'assets.read', 'assets:product:*', `${audience}:assets:read`]) {
        assert.throws(() => tenantRuntimeTokenScope(audience, invalid, 'business'))
      }
    }
  })
  test('permits only AA-04’s fixed raw Aims and receivable combination', () => {
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      assert.equal(
        tenantRuntimeTokenScope(audience, 'aims.write altoc:receivable:mark-billable', 'aims-milestone-receivable'),
        'aims.write altoc:receivable:mark-billable'
      )
    }
    assert.throws(() => tenantRuntimeTokenScope('data-runtime', 'aims.write altoc:service-ticket:delivery-result:sync', 'aims-milestone-receivable'))
    assert.throws(() => tenantRuntimeTokenScope('other-runtime', 'aims.write altoc:receivable:mark-billable', 'aims-milestone-receivable'))
  })
  test('binds transport and business capabilities to the requested audience', () => {
    assert.equal(
      tenantRuntimeTokenScope('data-runtime', 'altoc.read altoc:dashboard:view'),
      'data-runtime:altoc:read data-runtime:altoc:dashboard:view'
    )
    assert.equal(
      tenantRuntimeTokenScope('tenant-runtime', 'altoc.write altoc:lead:convert'),
      'tenant-runtime:altoc:write tenant-runtime:altoc:lead:convert'
    )
    assert.equal(
      tenantRuntimeTokenScope('data-runtime', 'console:auth-client:sync console:org-profile:view'),
      'console:auth-client:sync console:org-profile:view'
    )
  })
})

describe('tenant runtime bootstrap token classification', () => {
  function unsignedToken(payload: Record<string, unknown>) {
    return [
      Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'platform-key' })).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      'signature'
    ].join('.')
  }

  test('recognizes only the Platform Runtime bootstrap token use', () => {
    assert.equal(
      isPlatformRuntimeBootstrapToken(unsignedToken({
        token_use: 'platform_runtime_bootstrap',
        aud: 'data-runtime-bootstrap'
      })),
      true
    )
    assert.equal(
      isPlatformRuntimeBootstrapToken(unsignedToken({
        token_use: 'service',
        aud: 'data-runtime'
      })),
      false
    )
    assert.equal(isPlatformRuntimeBootstrapToken('opaque-enrollment-token'), false)
  })
})

describe('managed Console Runtime bootstrap refresh', () => {
  test('reuses the trusted forwarded Platform bootstrap during Console scheduler token exchange', async () => {
    const bootstrapToken = [
      Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'platform-key' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        token_use: 'platform_runtime_bootstrap',
        tenant: 'tenant-a',
        deployment: 'tenant-a-console',
        appCode: 'console',
        exp: Math.floor(Date.now() / 1000) + 90
      })).toString('base64url'),
      'signature'
    ].join('.')
    const requests: Array<{ url: string, authorization: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url || '',
        authorization: String(request.headers.authorization || '')
      })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/platform/internal/tenant-gateway/runtime-bootstrap-token') {
        response.statusCode = 409
        response.end(JSON.stringify({ message: 'duplicate bootstrap lookup must not happen' }))
        return
      }
      if (request.url === '/v1/console/auth/service-tokens/issue') {
        assert.equal(request.headers.authorization, `Bearer ${bootstrapToken}`)
        response.end(JSON.stringify({
          code: 0,
          data: {
            accessToken: 'scoped-platform-lifecycle-token',
            tokenType: 'Bearer',
            expiresIn: 90,
            scope: 'console:platform-lifecycle:execute'
          }
        }))
        return
      }
      assert.equal(request.url, '/v1/console/platform-lifecycle/drain/claim')
      assert.equal(request.headers.authorization, 'Bearer scoped-platform-lifecycle-token')
      response.end(JSON.stringify({ code: 0, data: null }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('bootstrap test server did not bind')

    const baseUrl = `http://127.0.0.1:${address.port}`
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => ({
      hzy: {
        cloudflareInternalToken: 'internal-gateway-token',
        platform: { baseUrl },
        tenantRuntime: { dataAccessMode: 'tenant-runtime' }
      }
    })
    setLocalServiceTokenIssuer(async ({ audience, scope, event: issuerEvent }) => {
      assert.equal(audience, 'data-runtime')
      assert.equal(scope, 'console:platform-lifecycle:execute')
      assert.ok(issuerEvent)
      const issued = await maybeCallTenantRuntime<{
        code: number
        data: { accessToken: string }
      }>(issuerEvent, '/v1/console/auth/service-tokens/issue', {
        appCode: 'console',
        scope: 'console:service-token:issue',
        method: 'POST',
        body: { audience, scope },
        requireStaticRuntimeToken: true
      })
      assert.equal(issued.handled, true)
      return issued.data.data.accessToken
    })
    const event = {
      context: {},
      node: {
        req: {
          headers: {
            'x-hzy-gateway': 'tenant-gateway',
            'x-hzy-gateway-token': 'internal-gateway-token',
            'x-hzy-tenant': 'tenant-a',
            'x-hzy-deployment': 'tenant-a-console',
            'x-hzy-environment': 'prod',
            'x-hzy-app-code': 'console',
            'x-hzy-data-runtime-url': baseUrl,
            'x-hzy-data-runtime-token': bootstrapToken
          },
          url: '/api/internal/integration-operations/drain'
        }
      }
    } as never

    try {
      const result = await maybeCallTenantRuntime(event, '/v1/console/platform-lifecycle/drain/claim', {
        appCode: 'console',
        scope: 'console:platform-lifecycle:execute',
        method: 'POST',
        body: {}
      })
      assert.equal(result.handled, true)
      assert.deepEqual(requests.map(item => item.url), [
        '/v1/console/auth/service-tokens/issue',
        '/v1/console/platform-lifecycle/drain/claim'
      ])
    } finally {
      setLocalServiceTokenIssuer(null)
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  test('uses a trusted forwarded bootstrap token for non-Console service-token callers', async () => {
    const bootstrapToken = [
      Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'platform-key' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        token_use: 'platform_runtime_bootstrap',
        tenant: 'tenant-a',
        deployment: 'tenant-a-console',
        appCode: 'console',
        exp: Math.floor(Date.now() / 1000) + 90
      })).toString('base64url'),
      'signature'
    ].join('.')
    const requests: Array<{ url: string, authorization: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url || '',
        authorization: String(request.headers.authorization || '')
      })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ code: 0, data: { consumed: true } }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('bootstrap test server did not bind')

    const baseUrl = `http://127.0.0.1:${address.port}`
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => ({
      hzy: {
        cloudflareInternalToken: 'internal-gateway-token',
        platform: { baseUrl: 'http://platform.invalid' },
        tenantRuntime: { dataAccessMode: 'tenant-runtime' }
      }
    })
    setLocalServiceTokenIssuer(async ({ audience, scope }) => {
      assert.equal(audience, 'data-runtime')
      assert.equal(scope, 'console:service-client:consume')
      return 'scoped-service-client-consume-token'
    })
    const event = {
      context: {},
      node: {
        req: {
          headers: {
            'x-hzy-gateway': 'tenant-gateway',
            'x-hzy-gateway-token': 'internal-gateway-token',
            'x-hzy-tenant': 'tenant-a',
            'x-hzy-deployment': 'tenant-a-console',
            'x-hzy-environment': 'prod',
            'x-hzy-app-code': 'workflow',
            'x-hzy-data-runtime-url': baseUrl,
            'x-hzy-data-runtime-token': bootstrapToken
          },
          url: '/oauth/token'
        }
      }
    } as never

    try {
      const result = await maybeCallTenantRuntime(event, '/v1/console/auth/runtime-app-identities/consume', {
        appCode: 'console',
        scope: 'console:service-client:consume',
        method: 'POST',
        body: { appCode: 'workflow' },
        requireStaticRuntimeToken: true
      })
      assert.equal(result.handled, true)
      assert.deepEqual(requests, [{
        url: '/v1/console/auth/runtime-app-identities/consume',
        authorization: 'Bearer scoped-service-client-consume-token'
      }])
    } finally {
      setLocalServiceTokenIssuer(null)
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  test('exchanges the Platform bootstrap for an exactly scoped token before consuming a service client', async () => {
    const freshToken = [
      Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'current-platform-key' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        token_use: 'platform_runtime_bootstrap',
        tenant: 'tenant-a',
        deployment: 'tenant-a-console',
        appCode: 'console',
        exp: Math.floor(Date.now() / 1000) + 90
      })).toString('base64url'),
      'signature'
    ].join('.')
    const requests: Array<{
      method: string
      url: string
      authorization: string
      userAgent: string
      body: string
    }> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        requests.push({
          method: request.method || '',
          url: request.url || '',
          authorization: String(request.headers.authorization || ''),
          userAgent: String(request.headers['user-agent'] || ''),
          body
        })
        response.setHeader('content-type', 'application/json')
        if (request.url === '/api/platform/internal/tenant-gateway/runtime-bootstrap-token') {
          response.end(JSON.stringify({
            data: {
              token: freshToken,
              expiresAt: new Date(Date.now() + 90_000).toISOString(),
              tenantCode: 'tenant-a',
              deploymentCode: 'tenant-a-console',
              appCode: 'console'
            }
          }))
          return
        }
        if (request.url === '/v1/console/auth/service-tokens/issue') {
          assert.equal(request.headers.authorization, `Bearer ${freshToken}`)
          response.end(JSON.stringify({
            code: 0,
            data: {
              accessToken: 'scoped-service-client-consume-token',
              tokenType: 'Bearer',
              expiresIn: 90,
              scope: 'console:service-client:consume'
            }
          }))
          return
        }
        if (request.url === '/v1/console/auth/service-clients/consume') {
          assert.equal(request.headers.authorization, 'Bearer scoped-service-client-consume-token')
        }
        response.end(JSON.stringify({ code: 0, data: { consumed: true } }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('bootstrap test server did not bind')

    const baseUrl = `http://127.0.0.1:${address.port}`
    const config = {
      hzy: {
        cloudflareInternalToken: 'internal-gateway-token',
        platform: { baseUrl },
        tenantRuntime: {
          endpoint: baseUrl,
          token: [
            Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'stale-platform-key' })).toString('base64url'),
            Buffer.from(JSON.stringify({ token_use: 'legacy_runtime' })).toString('base64url'),
            'signature'
          ].join('.'),
          tenant: 'tenant-a',
          deployment: 'tenant-a-console',
          dataAccessMode: 'tenant-runtime'
        }
      }
    }
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => config
    setLocalServiceTokenIssuer(async ({ audience, scope, event: issuerEvent }) => {
      assert.equal(audience, 'data-runtime')
      assert.equal(scope, 'console:service-client:consume')
      assert.ok(issuerEvent)
      const issued = await maybeCallTenantRuntime<{
        code: number
        data: { accessToken: string }
      }>(issuerEvent, '/v1/console/auth/service-tokens/issue', {
        appCode: 'console',
        scope: 'console:service-token:issue',
        method: 'POST',
        body: { audience, scope },
        requireStaticRuntimeToken: true
      })
      assert.equal(issued.handled, true)
      return issued.data.data.accessToken
    })
    const event = {
      context: {},
      node: {
        req: {
          headers: {
            'x-hzy-gateway': 'tenant-gateway',
            'x-hzy-gateway-token': 'internal-gateway-token',
            'x-hzy-tenant': 'tenant-a',
            'x-hzy-deployment': 'tenant-a-console',
            'x-hzy-environment': 'prod',
            'x-hzy-app-code': 'console'
          },
          url: '/oauth/token'
        }
      }
    } as never

    try {
      const result = await maybeCallTenantRuntime(event, '/v1/console/auth/service-clients/consume', {
        appCode: 'console',
        scope: 'console:service-client:consume',
        method: 'POST',
        body: { clientId: 'connector.runtime' },
        requireStaticRuntimeToken: true
      })
      assert.equal(result.handled, true)
      assert.equal(requests.length, 3)
      assert.equal(requests[0]?.url, '/api/platform/internal/tenant-gateway/runtime-bootstrap-token')
      assert.equal(requests[0]?.authorization, 'Bearer internal-gateway-token')
      assert.equal(requests[0]?.userAgent, 'HZY-Cloudflare-Worker/1.0')
      assert.deepEqual(JSON.parse(requests[0]?.body || '{}'), {
        tenantCode: 'tenant-a',
        environment: 'prod',
        appCode: 'console'
      })
      assert.equal(requests[1]?.url, '/v1/console/auth/service-tokens/issue')
      assert.equal(requests[1]?.authorization, `Bearer ${freshToken}`)
      assert.equal(requests[1]?.userAgent, 'HZY-Cloudflare-Worker/1.0')
      assert.equal(requests[2]?.url, '/v1/console/auth/service-clients/consume')
      assert.equal(requests[2]?.authorization, 'Bearer scoped-service-client-consume-token')
      assert.equal(requests[2]?.userAgent, 'HZY-Cloudflare-Worker/1.0')
    } finally {
      setLocalServiceTokenIssuer(null)
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

function verifyServiceCommandHeaderContract(input: {
  headers: ServiceCommandHeaders
  token: string
  method: string
  requestTarget: string
  requestId: string
  now: number
  tenantCode: string
  targetDeploymentCode: string
  targetApp: string
}) {
  const { headers } = input
  assert.equal(headers['x-hzy-service-command-tenant'], input.tenantCode)
  assert.equal(headers['x-hzy-service-command-target-deployment'], input.targetDeploymentCode)
  assert.equal(headers['x-hzy-service-command-target-app'], input.targetApp)
  assert.notEqual(headers['x-hzy-service-command-source-app'], input.targetApp)
  const signedAt = Number(headers['x-hzy-service-command-signed-at'])
  assert.equal(Number.isSafeInteger(signedAt), true)
  assert.ok(signedAt <= input.now + 5_000, 'signature timestamp is too far in the future')
  assert.ok(input.now - signedAt <= 60_000, 'signature timestamp is older than 60 seconds')
  const canonical = [
    input.method,
    input.requestTarget,
    headers['x-hzy-service-command-tenant'],
    headers['x-hzy-service-command-source-deployment'],
    headers['x-hzy-service-command-target-deployment'],
    headers['x-hzy-service-command-source-app'],
    headers['x-hzy-service-command-source-client'],
    headers['x-hzy-service-command-target-app'],
    headers['x-hzy-service-command-operation-id'],
    headers['x-hzy-service-command-operation-code'],
    headers['x-hzy-service-command-capability'],
    headers['x-hzy-service-command-idempotency-key'],
    headers['x-hzy-service-command-schema-version'],
    headers['x-hzy-service-command-sha256'],
    input.requestId,
    headers['x-hzy-service-command-signed-at']
  ].join('\n')
  const expected = createHmac('sha256', input.token).update(canonical).digest('base64url')
  assert.equal(headers['x-hzy-service-command-signature'], expected)
}

describe('tenantRuntimeErrorData', () => {
  test('preserves business error code and 4xx status from tenant runtime', () => {
    assert.deepEqual(
      tenantRuntimeErrorData({
        statusCode: 409,
        data: { error: { code: 'coverage_target_conflict', message: 'target already exists' } }
      }),
      {
        statusCode: 409,
        code: 'coverage_target_conflict',
        message: 'target already exists',
        upstreamStatus: 409
      }
    )
  })

  test('maps upstream 5xx to explicit fail-closed 503 while preserving upstream status', () => {
    const proxied = tenantRuntimeErrorData({
      status: 503,
      data: { error: { code: 'runtime_unavailable', message: 'runtime down' } }
    })
    assert.deepEqual(
      proxied,
      {
        statusCode: 503,
        code: 'runtime_unavailable',
        message: 'runtime down',
        upstreamStatus: 503
      }
    )
    assert.deepEqual(classifyServiceOperationFailure({ statusCode: proxied.statusCode, data: proxied }), {
      statusCode: 503,
      code: 'runtime_unavailable',
      classification: 'transient',
      retryable: true,
      idempotentSuccess: false,
      timedOut: false,
      networkError: false,
      summary: 'runtime down'
    })
  })

  test('preserves wrong audience and service-command context failures as terminal classifications', () => {
    const invalidAudience = tenantRuntimeErrorData({
      statusCode: 401,
      data: { error: { code: 'invalid_token_audience', message: 'token audience rejected' } }
    })
    const audienceFailure = classifyServiceOperationFailure({
      statusCode: invalidAudience.statusCode,
      data: invalidAudience
    })
    assert.equal(audienceFailure.statusCode, 401)
    assert.equal(audienceFailure.code, 'invalid_token_audience')
    assert.equal(audienceFailure.classification, 'authentication')
    assert.equal(audienceFailure.retryable, false)

    const invalidContext = tenantRuntimeErrorData({
      statusCode: 403,
      data: { error: { code: 'service_command_context_invalid', message: 'signed context rejected' } }
    })
    const contextFailure = classifyServiceOperationFailure({
      statusCode: invalidContext.statusCode,
      data: invalidContext
    })
    assert.equal(contextFailure.statusCode, 403)
    assert.equal(contextFailure.code, 'service_command_context_invalid')
    assert.equal(contextFailure.classification, 'authorization')
    assert.equal(contextFailure.retryable, false)
  })
})

describe('tenant runtime outage handling', () => {
  test('returns explicit 503 for a network outage and never reports an unhandled fallback', async () => {
    const config = {
      hzy: {
        tenantRuntime: {
          endpoint: 'http://127.0.0.1:1',
          token: 'isolated-unreachable-runtime-token',
          tenant: 'tenant-a',
          deployment: 'deployment-a',
          dataAccessMode: 'tenant-runtime'
        }
      }
    }
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    const originalWarn = console.warn
    const warnings: Array<{ message: unknown, detail: unknown }> = []
    globals.useRuntimeConfig = () => config
    console.warn = (message: unknown, detail: unknown) => {
      warnings.push({ message, detail })
    }
    const event = {
      context: {},
      node: { req: { headers: {}, url: '/api/v1/console/profile' } }
    } as never

    try {
      await assert.rejects(
        () => maybeCallTenantRuntime(event, '/v1/console/profile', {
          appCode: 'console',
          scope: 'console:org-profile:view',
          method: 'GET'
        }),
        (error: unknown) => {
          const failure = error as {
            statusCode?: number
            statusMessage?: string
            data?: { code?: string, upstreamStatus?: number }
          }
          assert.equal(failure.statusCode, 503)
          assert.equal(failure.statusMessage, 'Tenant Runtime unavailable')
          assert.equal(failure.data?.upstreamStatus, 503)
          return true
        }
      )
      assert.equal(warnings.length, 1)
      assert.equal(warnings[0]?.message, '[tenantRuntimeClient] tenant runtime request failed')
      assert.equal((warnings[0]?.detail as { appCode?: string }).appCode, 'console')
      assert.equal((warnings[0]?.detail as { path?: string }).path, '/v1/console/profile')
      assert.equal((warnings[0]?.detail as { upstreamStatus?: number }).upstreamStatus, 503)
    } finally {
      console.warn = originalWarn
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
    }
  })
})

describe('service command runtime context', () => {
  test('signs source and target deployment identity with the short runtime bearer', async () => {
    const envelope = {
      operationId: '550e8400-e29b-41d4-a716-446655440000',
      targetApp: 'altoc',
      operationCode: 'aims.work-item.ticket-result.v1',
      requiredCapability: 'altoc:service_ticket:delivery-result:sync',
      idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
      commandSchemaVersion: 'v1',
      commandSha256: 'a'.repeat(64)
    }
    const headers = await buildServiceCommandRuntimeHeaders({
      token: 'short-lived-runtime-bearer',
      method: 'POST',
      requestTarget: '/v1/altoc/service/service-tickets/ST-1/delivery-result:sync',
      requestId: 'REQ-1',
      tenantCode: 'TENANT-A',
      sourceDeploymentCode: 'AIMS-DEPLOYMENT',
      targetDeploymentCode: 'ALTOC-DEPLOYMENT',
      sourceApp: 'aims',
      sourceClientId: 'aims.runtime',
      targetApp: 'altoc',
      envelope,
      signedAt: '1700000000000'
    })
    const canonical = [
      'POST',
      '/v1/altoc/service/service-tickets/ST-1/delivery-result:sync',
      'TENANT-A',
      'AIMS-DEPLOYMENT',
      'ALTOC-DEPLOYMENT',
      'aims',
      'aims.runtime',
      'altoc',
      envelope.operationId,
      envelope.operationCode,
      envelope.requiredCapability,
      envelope.idempotencyKey,
      envelope.commandSchemaVersion,
      envelope.commandSha256,
      'REQ-1',
      '1700000000000'
    ].join('\n')
    const expected = createHmac('sha256', 'short-lived-runtime-bearer')
      .update(canonical)
      .digest('base64url')
    assert.equal(headers['x-hzy-service-command-signature'], expected)
    assert.equal(headers['x-hzy-service-command-source-deployment'], 'AIMS-DEPLOYMENT')
    assert.equal(headers['x-hzy-service-command-target-deployment'], 'ALTOC-DEPLOYMENT')
    assert.equal(JSON.stringify(headers).includes('short-lived-runtime-bearer'), false)
  })

  test('rejects source equals target and target mismatch before signing', async () => {
    await assert.rejects(() => buildServiceCommandRuntimeHeaders({
      token: 'token',
      method: 'POST',
      requestTarget: '/v1/altoc/write',
      requestId: '',
      tenantCode: 'TENANT-A',
      sourceDeploymentCode: 'DEP-A',
      targetDeploymentCode: 'DEP-B',
      sourceApp: 'altoc',
      sourceClientId: 'altoc.runtime',
      targetApp: 'altoc',
      envelope: {
        operationId: '550e8400-e29b-41d4-a716-446655440000',
        targetApp: 'assets',
        operationCode: 'op.v1',
        requiredCapability: 'altoc:write',
        idempotencyKey: 'key',
        commandSchemaVersion: 'v1',
        commandSha256: 'a'.repeat(64)
      },
      signedAt: '1700000000000'
    }), /context is incomplete/)
  })

  test('cryptographically binds capability, tenant, app, deployment and idempotency identity', async () => {
    const base = {
      token: 'short-lived-runtime-bearer',
      method: 'POST' as const,
      requestTarget: '/v1/altoc/service/service-tickets/ST-1/delivery-result:sync',
      requestId: 'REQ-1',
      tenantCode: 'TENANT-A',
      sourceDeploymentCode: 'AIMS-DEPLOYMENT',
      targetDeploymentCode: 'ALTOC-DEPLOYMENT',
      sourceApp: 'aims',
      sourceClientId: 'aims.runtime',
      targetApp: 'altoc',
      envelope: {
        operationId: '550e8400-e29b-41d4-a716-446655440000',
        targetApp: 'altoc',
        operationCode: 'aims.work-item.ticket-result.v1',
        requiredCapability: 'altoc:service_ticket:delivery-result:sync',
        idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
        commandSchemaVersion: 'v1',
        commandSha256: 'a'.repeat(64)
      },
      signedAt: '1700000000000'
    }
    const baseline = await buildServiceCommandRuntimeHeaders(base)
    const mutations: Array<{
      name: string
      change?: Partial<Omit<typeof base, 'envelope'>>
      envelope?: Partial<typeof base.envelope>
    }> = [
      { name: 'tenant', change: { tenantCode: 'TENANT-B' } },
      { name: 'source deployment', change: { sourceDeploymentCode: 'AIMS-DEPLOYMENT-B' } },
      { name: 'target deployment', change: { targetDeploymentCode: 'ALTOC-DEPLOYMENT-B' } },
      { name: 'source app', change: { sourceApp: 'finance' } },
      { name: 'source client', change: { sourceClientId: 'aims.other-runtime' } },
      { name: 'capability', envelope: { requiredCapability: 'altoc:service_ticket:admin' } },
      { name: 'operation id', envelope: { operationId: '770e8400-e29b-41d4-a716-446655440000' } },
      { name: 'operation code', envelope: { operationCode: 'aims.work-item.ticket-result.v2' } },
      { name: 'idempotency key', envelope: { idempotencyKey: 'aims:work-item:WI-1:ticket-result:open:v1' } },
      { name: 'schema version', envelope: { commandSchemaVersion: 'v2' } },
      { name: 'command hash', envelope: { commandSha256: 'b'.repeat(64) } }
    ]

    for (const mutation of mutations) {
      const headers = await buildServiceCommandRuntimeHeaders({
        ...base,
        ...(mutation.change || {}),
        envelope: { ...base.envelope, ...(mutation.envelope || {}) }
      })
      assert.notEqual(
        headers['x-hzy-service-command-signature'],
        baseline['x-hzy-service-command-signature'],
        `${mutation.name} must be covered by the service-command signature`
      )
    }
  })

  test('interoperates with the 60-second target verification contract and rejects signed-header tampering', async () => {
    const signedAt = 1_700_000_000_000
    const input = {
      token: 'short-lived-runtime-bearer',
      method: 'POST' as const,
      requestTarget: '/v1/altoc/service/service-tickets/ST-1/delivery-result:sync',
      requestId: 'REQ-1',
      tenantCode: 'TENANT-A',
      sourceDeploymentCode: 'AIMS-DEPLOYMENT',
      targetDeploymentCode: 'ALTOC-DEPLOYMENT',
      sourceApp: 'aims',
      sourceClientId: 'aims.runtime',
      targetApp: 'altoc',
      envelope: {
        operationId: '550e8400-e29b-41d4-a716-446655440000',
        targetApp: 'altoc',
        operationCode: 'aims.work-item.ticket-result.v1',
        requiredCapability: 'altoc:service_ticket:delivery-result:sync',
        idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
        commandSchemaVersion: 'v1',
        commandSha256: 'a'.repeat(64)
      },
      signedAt: String(signedAt)
    }
    const headers = await buildServiceCommandRuntimeHeaders(input)
    const verification = {
      headers,
      token: input.token,
      method: input.method,
      requestTarget: input.requestTarget,
      requestId: input.requestId,
      tenantCode: input.tenantCode,
      targetDeploymentCode: input.targetDeploymentCode,
      targetApp: input.targetApp
    }
    verifyServiceCommandHeaderContract({ ...verification, now: signedAt + 60_000 })
    assert.throws(
      () => verifyServiceCommandHeaderContract({ ...verification, now: signedAt + 60_001 }),
      /older than 60 seconds/
    )

    for (const header of [
      'x-hzy-service-command-tenant',
      'x-hzy-service-command-source-deployment',
      'x-hzy-service-command-target-deployment',
      'x-hzy-service-command-source-app',
      'x-hzy-service-command-capability',
      'x-hzy-service-command-operation-id',
      'x-hzy-service-command-idempotency-key'
    ]) {
      assert.throws(() => verifyServiceCommandHeaderContract({
        ...verification,
        now: signedAt,
        headers: { ...headers, [header]: `${headers[header]}-tampered` }
      }), `${header} tampering must be rejected`)
    }
    assert.throws(() => verifyServiceCommandHeaderContract({
      ...verification,
      now: signedAt,
      token: 'bearer-for-a-different-audience'
    }), 'a bearer from another audience must not verify the signed context')
  })

  test('verifies a source service command HMAC before a target BFF re-signs its actor', async () => {
    const signedAt = 1_700_000_000_000
    const command = { actorUid: 'user-1', projectCode: 'PRJ-1', documentUuid: 'doc-1', action: 'content:read' }
    const base = {
      token: 'aims-short-lived-service-token',
      method: 'POST' as const,
      requestTarget: '/api/v1/service/project-documents/doc-1/content',
      requestId: 'REQ-1',
      tenantCode: 'TENANT-A',
      sourceDeploymentCode: 'DEPLOYMENT-A',
      targetDeploymentCode: 'DEPLOYMENT-A',
      sourceApp: 'aims',
      sourceClientId: 'aims',
      targetApp: 'codocs',
      envelope: {
        operationId: 'aims.codocs.project-document.content:abc',
        targetApp: 'codocs',
        operationCode: 'aims.codocs.project-document.content-read.v1',
        requiredCapability: 'codocs:project-document:content:read',
        idempotencyKey: 'aims:codocs:project-document:abc',
        commandSchemaVersion: 'aims.codocs.project-document.content.v1',
        commandSha256: await hashServiceCommandPayload(command)
      },
      signedAt: String(signedAt)
    }
    const headers = await buildServiceCommandRuntimeHeaders(base)
    const verify = async (change: Record<string, string> = {}, now = signedAt) => await verifyServiceCommandRuntimeHeaders({
      ...base,
      readHeader: name => ({ ...headers, ...change })[name] || '',
      now
    })

    await verify()
    for (const changedCommand of [
      { ...command, actorUid: 'other-user' },
      { ...command, projectCode: 'OTHER-PROJECT' },
      { ...command, documentUuid: 'other-doc' }
    ]) {
      const changedHash = await hashServiceCommandPayload(changedCommand)
      await assert.rejects(
        () => verify({ 'x-hzy-service-command-sha256': changedHash }),
        /signature context is invalid/
      )
    }
    for (const name of [
      'x-hzy-service-command-operation-id',
      'x-hzy-service-command-capability',
      'x-hzy-service-command-sha256',
      'x-hzy-service-command-source-app',
      'x-hzy-service-command-source-client',
      'x-hzy-service-command-target-deployment'
    ]) {
      await assert.rejects(() => verify({ [name]: 'tampered' }), /signature context is invalid/)
    }
    await assert.rejects(
      () => verifyServiceCommandRuntimeHeaders({
        ...base,
        requestTarget: '/api/v1/service/project-documents/doc-1/other',
        readHeader: name => headers[name] || '',
        now: signedAt
      }),
      /signature is invalid/
    )
    await assert.rejects(() => verify({}, signedAt + 60_001), /signature is expired/)
    await assert.rejects(() => verify({ 'x-hzy-service-command-signature': 'invalid' }), /signature is invalid/)
  })

  test('rejects each incomplete or contradictory trusted context independently', async () => {
    const base = {
      token: 'token',
      method: 'POST' as const,
      requestTarget: '/v1/altoc/write',
      requestId: 'REQ-1',
      tenantCode: 'TENANT-A',
      sourceDeploymentCode: 'DEP-A',
      targetDeploymentCode: 'DEP-B',
      sourceApp: 'aims',
      sourceClientId: 'aims.runtime',
      targetApp: 'altoc',
      envelope: {
        operationId: '550e8400-e29b-41d4-a716-446655440000',
        targetApp: 'altoc',
        operationCode: 'op.v1',
        requiredCapability: 'altoc:write',
        idempotencyKey: 'key',
        commandSchemaVersion: 'v1',
        commandSha256: 'a'.repeat(64)
      },
      signedAt: '1700000000000'
    }
    const invalidInputs: Array<{
      name: string
      change?: Partial<Omit<typeof base, 'envelope'>>
      envelope?: Partial<typeof base.envelope>
    }> = [
      { name: 'tenant', change: { tenantCode: '' } },
      { name: 'source deployment', change: { sourceDeploymentCode: '' } },
      { name: 'target deployment', change: { targetDeploymentCode: '' } },
      { name: 'source app', change: { sourceApp: '' } },
      { name: 'source client', change: { sourceClientId: '' } },
      { name: 'source equals target', change: { sourceApp: 'altoc' } },
      { name: 'envelope target mismatch', envelope: { targetApp: 'assets' } }
    ]

    for (const invalid of invalidInputs) {
      await assert.rejects(
        () => buildServiceCommandRuntimeHeaders({
          ...base,
          ...(invalid.change || {}),
          envelope: { ...base.envelope, ...(invalid.envelope || {}) }
        }),
        /context is incomplete/,
        invalid.name
      )
    }
  })
})

describe('notification detail runtime actor delegation', () => {
  test('signs only an exact Console service delegation and binds the actor purpose', async () => {
    const requests: Array<{ headers: Record<string, string | string[] | undefined>, body: string, url: string, method: string }> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        requests.push({
          headers: request.headers,
          body,
          url: request.url || '',
          method: request.method || ''
        })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ code: 0, data: { ok: true } }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('runtime test server did not bind')

    const runtimeToken = 'short-lived-aims-runtime-token'
    const config = {
      hzy: {
        tenantRuntime: {
          endpoint: `http://127.0.0.1:${address.port}`,
          token: runtimeToken,
          tenant: 'tenant-a',
          deployment: 'deployment-a',
          dataAccessMode: 'tenant-runtime'
        }
      }
    }
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => config

    const auth = {
      authenticated: true,
      subjectType: 'service',
      tokenUse: 'service',
      appCode: 'console',
      clientCode: 'console.runtime',
      scopes: ['aims:notification-details:authorize'],
      tenant: 'tenant-a',
      deployment: 'deployment-a'
    }
    const event = (consoleAuth: Record<string, unknown>) => ({
      context: { consoleAuth },
      node: { req: { headers: {}, url: '/api/v1/service/notification-details/authorize' } }
    }) as never
    const options = {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'POST',
      query: {},
      body: { stage: 'prepare', descriptor: { resource: 'work_item', id: '42' } },
      notificationDetailActor: {
        uid: 'user-42',
        tenantId: 'tenant-a',
        deploymentId: 'deployment-a'
      }
    } as const

    try {
      const result = await maybeCallTenantRuntime(event(auth), '/v1/aims/notification-details/authorize', options)
      assert.equal(result.handled, true)
      assert.equal(requests.length, 1)
      const request = requests[0]!
      assert.equal(request.method, 'POST')
      assert.equal(request.url, '/v1/aims/notification-details/authorize')
      assert.equal(request.headers['x-hzy-actor-uid'], 'user-42')
      assert.equal(request.headers['x-hzy-actor-purpose'], 'notification-detail-authorization')
      assert.equal(request.headers['x-hzy-actor-dept-codes'], undefined)
      const signedAt = String(request.headers['x-hzy-actor-signed-at'] || '')
      const expected = createHmac('sha256', runtimeToken).update([
        'POST',
        '/v1/aims/notification-details/authorize',
        'user-42',
        '',
        signedAt,
        'notification-detail-authorization'
      ].join('\n')).digest('base64url')
      assert.equal(request.headers['x-hzy-actor-signature'], expected)
      assert.deepEqual(JSON.parse(request.body), options.body)

      const invalidCases: Array<{ name: string, auth?: Record<string, unknown>, path?: string, options?: Record<string, unknown> }> = [
        { name: 'browser actor', auth: { ...auth, tokenUse: 'access', subjectType: 'user' } },
        { name: 'wrong source', auth: { ...auth, appCode: 'assets' } },
        { name: 'missing capability', auth: { ...auth, scopes: [] } },
        { name: 'wrong token tenant', auth: { ...auth, tenant: 'tenant-b' } },
        { name: 'wrong token deployment', auth: { ...auth, deployment: 'deployment-b' } },
        { name: 'wrong runtime path', path: '/v1/aims/work-items/42' },
        { name: 'wrong method', options: { ...options, method: 'GET' } },
        { name: 'delegation tenant mismatch', options: { ...options, notificationDetailActor: { ...options.notificationDetailActor, tenantId: 'tenant-b' } } },
        { name: 'delegation deployment mismatch', options: { ...options, notificationDetailActor: { ...options.notificationDetailActor, deploymentId: 'deployment-b' } } }
      ]
      for (const invalid of invalidCases) {
        await assert.rejects(
          () => maybeCallTenantRuntime(
            event(invalid.auth || auth),
            invalid.path || '/v1/aims/notification-details/authorize',
            (invalid.options || options) as never
          ),
          error => Number((error as { statusCode?: number }).statusCode) === 403,
          invalid.name
        )
      }
      assert.equal(requests.length, 1, 'invalid delegations must fail before runtime network I/O')
    } finally {
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

describe('Workflow proxy runtime actor delegation', () => {
  test('re-signs only an app-bound workflow:proxy actor for the Workflow runtime', async () => {
    const requests: Array<{ headers: Record<string, string | string[] | undefined>, url: string, method: string }> = []
    const server = createServer((request, response) => {
      requests.push({ headers: request.headers, url: request.url || '', method: request.method || '' })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ code: 0, data: { ok: true } }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('runtime test server did not bind')

    const runtimeToken = 'short-lived-workflow-runtime-token'
    const config = {
      hzy: {
        tenantRuntime: {
          endpoint: `http://127.0.0.1:${address.port}`,
          token: runtimeToken,
          tenant: 'tenant-a',
          deployment: 'deployment-a',
          dataAccessMode: 'tenant-runtime'
        }
      }
    }
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => config

    const auth = {
      authenticated: true,
      subjectType: 'service',
      tokenUse: 'service',
      appCode: 'aims',
      clientCode: 'aims.runtime',
      scopes: ['workflow:proxy'],
      tenant: 'tenant-a',
      deployment: 'deployment-a'
    }
    const event = (consoleAuth: Record<string, unknown>, declaredApp = 'aims') => ({
      context: { consoleAuth },
      node: {
        req: {
          headers: { 'x-hzy-request-app-code': declaredApp },
          url: '/api/v1/instances/by-biz'
        }
      }
    }) as never
    const options = {
      appCode: 'workflow',
      scope: 'workflow.read',
      method: 'GET',
      query: { app_code: 'aims', resource_code: 'projects', biz_id: '42', action_code: 'initiation' },
      workflowProxyActor: { uid: 'user-42' }
    } as const

    try {
      const result = await maybeCallTenantRuntime(event(auth), '/v1/workflow/instances/by-biz', options)
      assert.equal(result.handled, true)
      assert.equal(requests.length, 1)
      const request = requests[0]!
      assert.equal(request.method, 'GET')
      assert.match(request.url, /^\/v1\/workflow\/instances\/by-biz\?/)
      assert.equal(request.headers['x-hzy-actor-uid'], 'user-42')
      assert.equal(request.headers['x-hzy-actor-purpose'], undefined)
      const signedAt = String(request.headers['x-hzy-actor-signed-at'] || '')
      const requestTarget = request.url
      const expected = createHmac('sha256', runtimeToken).update([
        'GET', requestTarget, 'user-42', '', signedAt
      ].join('\n')).digest('base64url')
      assert.equal(request.headers['x-hzy-actor-signature'], expected)

      const invalidCases: Array<{ name: string, auth?: Record<string, unknown>, declaredApp?: string, path?: string, options?: Record<string, unknown> }> = [
        { name: 'wrong source scope', auth: { ...auth, scopes: ['workflow:invoice-request:create'] } },
        { name: 'source app mismatch', auth: { ...auth, appCode: 'assets' } },
        { name: 'declared app mismatch', declaredApp: 'assets' },
        { name: 'tenant mismatch', auth: { ...auth, tenant: 'tenant-b' } },
        { name: 'deployment mismatch', auth: { ...auth, deployment: 'deployment-b' } },
        { name: 'non-workflow target', path: '/v1/aims/work-items/42', options: { ...options, appCode: 'aims' } }
      ]
      for (const invalid of invalidCases) {
        await assert.rejects(
          () => maybeCallTenantRuntime(
            event(invalid.auth || auth, invalid.declaredApp || 'aims'),
            invalid.path || '/v1/workflow/instances/by-biz',
            (invalid.options || options) as never
          ),
          error => Number((error as { statusCode?: number }).statusCode) === 403,
          invalid.name
        )
      }
      assert.equal(requests.length, 1, 'invalid proxy delegations must fail before runtime network I/O')
    } finally {
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

describe('unified scheduler route table', () => {
  test('each unified route is bound to its own app, exact scope and POST before any network call', async () => {
    const config = { hzy: { tenantRuntime: { endpoint: 'http://127.0.0.1:1', tenant: 'tenant-a', deployment: 'deployment-a', dataAccessMode: 'tenant-runtime' } } }
    const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
    const originalUseRuntimeConfig = globals.useRuntimeConfig
    globals.useRuntimeConfig = () => config
    const event = { context: {}, node: { req: { headers: {}, url: '/api/internal/integration-operations/drain' } } } as never
    const scheduler = { generation: '7' }
    const statusOf = async (path: string, options: Parameters<typeof maybeCallTenantRuntime>[2]) => {
      try {
        await maybeCallTenantRuntime(event, path, options)
      } catch (error) {
        return (error as { statusCode?: number }).statusCode
      }
      return 200
    }
    try {
      const contractViolations: Array<[string, Parameters<typeof maybeCallTenantRuntime>[2]]> = [
        ['/v1/enterprise/assets/notifications:scan-due', { appCode: 'aims', scope: 'assets:notifications-due:execute', method: 'POST', body: {}, enterpriseScheduler: scheduler }],
        ['/v1/enterprise/aims/milestones:rollover-due', { appCode: 'aims', scope: 'aims:integration_operation:execute', method: 'POST', body: {}, enterpriseScheduler: scheduler }],
        ['/v1/enterprise/aims/notifications:scan-due', { appCode: 'aims', scope: 'aims:milestone-rollover:execute', method: 'POST', body: {}, enterpriseScheduler: scheduler }],
        ['/v1/enterprise/aims/notifications:acknowledge', { appCode: 'aims', scope: 'aims:notifications-due:execute', method: 'POST', body: {} }],
        ['/v1/aims/service/notifications:scan-due', { appCode: 'aims', scope: 'aims:notifications-due:execute', method: 'POST', body: {}, enterpriseScheduler: scheduler }],
        ['/v1/enterprise/assets/notifications:acknowledge-closure', { appCode: 'assets', scope: 'assets:notifications-due:execute', method: 'GET', enterpriseScheduler: scheduler }]
      ]
      for (const [path, options] of contractViolations) {
        assert.equal(await statusOf(path, options), 403, `${path} ${JSON.stringify(options)}`)
      }
      // A correct contract still requires the signed Gateway wake of the route's app.
      assert.equal(await statusOf('/v1/enterprise/assets/notifications:scan-due', { appCode: 'assets', scope: 'assets:notifications-due:execute', method: 'POST', body: {}, enterpriseScheduler: scheduler }), 404)
      assert.equal(await statusOf('/v1/enterprise/aims/milestones:rollover-due', { appCode: 'aims', scope: 'aims:milestone-rollover:execute', method: 'POST', body: {}, enterpriseScheduler: scheduler }), 404)
    } finally {
      if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
      else delete globals.useRuntimeConfig
    }
  })
})
