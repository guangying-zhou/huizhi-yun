import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createError, getHeader, type H3Event } from 'h3'
import ts from 'typescript'
import { fetchConsoleServiceJson, trustedServiceRequestHeaders } from '../server/utils/serviceOidc.ts'
import { resolveTrustedTenantGatewayContext } from '../server/utils/tenantGatewayTrust.ts'

type RecordValue = Record<string, unknown>
interface RequestCall {
  url: string
  method: string
  headers: Record<string, string>
  body: RecordValue
}
interface TokenRequest {
  audience: string
  scope: string
  event: H3Event
  forceRefresh?: boolean
  request?: (token: string) => Promise<unknown>
}

const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown, $fetch?: unknown }
const originalFetch = globals.fetch
const originalExternalFetch = globals.$fetch
const originalRuntimeConfig = globals.useRuntimeConfig
let publicFetchCalls = 0
const runtimeConfig = () => ({ hzy: { appCode: 'workflow', cloudflareInternalToken: 'test-gateway-token' } })
const publicFetchForbidden = async () => {
  publicFetchCalls += 1
  throw new Error('Console requests must use the Service Binding')
}

beforeEach(() => {
  publicFetchCalls = 0
  globals.fetch = publicFetchForbidden
  globals.$fetch = publicFetchForbidden
  globals.useRuntimeConfig = runtimeConfig
})

afterEach(() => {
  globals.fetch = originalFetch
  if (originalExternalFetch === undefined) delete globals.$fetch
  else globals.$fetch = originalExternalFetch
  if (originalRuntimeConfig === undefined) delete globals.useRuntimeConfig
  else globals.useRuntimeConfig = originalRuntimeConfig
  assert.equal(publicFetchCalls, 0)
})

function loadModule(path: string, dependencies: RecordValue) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: RecordValue = {}
  runInNewContext(code, {
    exports,
    URL,
    createError,
    useRuntimeConfig: runtimeConfig,
    console: { error: () => {} },
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    }
  })
  return exports
}

function bindingEvent(calls: RequestCall[], response: (index: number) => Response, trusted = true) {
  return {
    node: {
      req: {
        headers: {
          'x-hzy-gateway': 'tenant-gateway',
          'x-hzy-gateway-token': trusted ? 'test-gateway-token' : 'forged-token',
          'x-hzy-tenant': 'T1',
          'x-hzy-deployment': 'T1-workflow',
          'x-hzy-environment': 'prod',
          'x-hzy-app-code': 'workflow',
          'x-forwarded-host': 'tenant.example.test',
          'x-forwarded-prefix': '/workflow',
          'x-forwarded-proto': 'https',
          'x-hzy-data-runtime-token': 'test-runtime-bootstrap-token',
          'cookie': 'browser-session=must-not-forward'
        }
      }
    },
    context: {
      cloudflare: {
        env: {
          HZY_CONSOLE_SERVICE: {
            async fetch(input: string | URL | Request, init?: RequestInit) {
              calls.push({
                url: input instanceof Request ? input.url : String(input),
                method: String(init?.method || 'GET'),
                headers: Object.fromEntries(new Headers(init?.headers)),
                body: JSON.parse(String(init?.body || '{}')) as RecordValue
              })
              return response(calls.length)
            }
          }
        }
      }
    }
  } as unknown as H3Event
}

function assertHeaders(call: RequestCall, trusted: boolean) {
  assert.equal(call.method, 'POST')
  assert.equal(call.headers['content-type'], 'application/json')
  assert.equal(call.headers.cookie, undefined)
  if (trusted) {
    assert.equal(call.headers['x-hzy-tenant'], 'T1')
    assert.equal(call.headers['x-hzy-deployment'], 'T1-workflow')
    assert.equal(call.headers['x-hzy-app-code'], 'workflow')
    assert.equal(call.headers['x-forwarded-prefix'], '/workflow')
    assert.equal(call.headers['x-hzy-data-runtime-token'], 'test-runtime-bootstrap-token')
  } else {
    assert.deepEqual(Object.keys(call.headers).filter(name => name.startsWith('x-hzy-') || name.startsWith('x-forwarded-')), [])
  }
}

function lifecycleClient() {
  const tokens: TokenRequest[] = []
  const checkpoints: string[] = []
  const lifecycle = loadModule('../../workflow/server/utils/runtimeActionableLifecycles.ts', {})
  const client = loadModule('../../workflow/server/utils/dataRuntime.ts', {
    'h3': { getHeader },
    'ofetch': { $fetch: publicFetchForbidden },
    '@hzy/foundation/server/utils/tenantRuntimeClient': {
      maybeCallTenantRuntime: async (_event: H3Event, path: string) => {
        checkpoints.push(path)
        return { handled: true, data: { code: 0, data: {} } }
      }
    },
    '@hzy/foundation/server/utils/serviceOidc': {
      fetchConsoleServiceJson,
      trustedServiceRequestHeaders,
      requestServiceAccessToken: async (request: TokenRequest) => {
        tokens.push(request)
        assert.equal(request.audience, 'notifications')
        assert.equal(request.scope, 'notifications:publish')
        return request.forceRefresh ? 'refreshed-token' : 'initial-token'
      }
    },
    '@hzy/foundation/server/utils/serviceAppUrl': { resolveServiceAppBaseUrl: () => 'https://tenant.example.test/console' },
    '@hzy/foundation/server/utils/notify': {},
    '@hzy/foundation/server/utils/cloudflareServiceBinding': {},
    '@hzy/foundation/server/utils/tenantGatewayTrust': { resolveTrustedTenantGatewayContext },
    '@hzy/foundation/server/utils/notificationActionTarget': {},
    '@hzy/foundation/server/utils/subjectEligibility': {},
    './runtimeNotifications': {},
    './localCallbackContext': loadModule('../../workflow/server/utils/localCallbackContext.ts', {}),
    './runtimeActionableLifecycles': lifecycle
  })
  const deliver = client.deliverWorkflowActionableLifecycles as (event: H3Event, effects: RecordValue[]) => Promise<Array<{ status: string, code?: string }>>
  return { tokens, checkpoints, deliver }
}

const effect = { effectId: 42, actionableKey: 'workflow:task:17', expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved', recipients: ['user-1'] }

for (const trusted of [true, false]) {
  test(`lifecycle default transport uses binding and ${trusted ? 'forwards trusted' : 'omits forged'} gateway headers`, async () => {
    const calls: RequestCall[] = []
    const event = bindingEvent(calls, () => Response.json({ code: 0 }), trusted)
    const client = lifecycleClient()
    const results = await client.deliver(event, [effect])
    assert.equal(results[0]?.status, 'delivered')
    assert.deepEqual(client.checkpoints, ['/v1/workflow/actionable-lifecycle-effects/42/ack'])
    assert.equal(client.tokens[0]?.event, event)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, 'https://tenant.example.test/api/v1/console/notifications/actionable-lifecycle')
    assertHeaders(calls[0]!, trusted)
    assert.equal(calls[0]!.headers.authorization, 'Bearer initial-token')
    assert.deepEqual(calls[0]!.body, {
      sourceAppCode: 'workflow', actionableKey: effect.actionableKey, expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved', recipients: ['user-1']
    })
  })
}

test('binding 503 keeps the lifecycle pending and records a failure checkpoint', async () => {
  const calls: RequestCall[] = []
  const client = lifecycleClient()
  const results = await client.deliver(bindingEvent(calls, () => Response.json({ message: 'console_unavailable' }, { status: 503 })), [effect])
  assert.equal(results[0]?.status, 'pending')
  assert.equal(results[0]?.code, 'console_actionable_lifecycle_failed')
  assert.deepEqual(client.checkpoints, ['/v1/workflow/actionable-lifecycle-effects/42/fail'])
  assert.equal(calls.length, 1)
  assert.equal(client.tokens.length, 1)
})

for (const secondStatus of [200, 401]) {
  test(`binding 401 refreshes the lifecycle token once, then handles ${secondStatus}`, async () => {
    const calls: RequestCall[] = []
    const client = lifecycleClient()
    const event = bindingEvent(calls, index => Response.json({}, { status: index === 1 ? 401 : secondStatus }))
    const results = await client.deliver(event, [effect])
    assert.equal(results[0]?.status, secondStatus === 200 ? 'delivered' : 'pending')
    assert.equal(calls.length, 2)
    assert.equal(client.tokens.length, 2)
    assert.equal(client.tokens[0]?.forceRefresh, undefined)
    assert.equal(client.tokens[1]?.forceRefresh, true)
    assert.equal(calls[1]!.headers.authorization, 'Bearer refreshed-token')
    assert.deepEqual(client.checkpoints, [`/v1/workflow/actionable-lifecycle-effects/42/${secondStatus === 200 ? 'ack' : 'fail'}`])
  })
}

function notificationDrainClient(statuses: string[]) {
  const checkpoints: string[] = []
  const published: RecordValue[] = []
  const pending = statuses.map((_, index) => ({ effectId: index + 1, notification: { idempotencyKey: `k${index + 1}`, eventType: 'workflow.task.created' } }))
  const client = loadModule('../../workflow/server/utils/dataRuntime.ts', {
    'h3': { getHeader },
    'ofetch': { $fetch: publicFetchForbidden },
    '@hzy/foundation/server/utils/tenantRuntimeClient': {
      maybeCallTenantRuntime: async (_event: H3Event, path: string) => {
        if (path === '/v1/workflow/notification-effects/pending') return { handled: true, data: { code: 0, data: pending } }
        checkpoints.push(path)
        return { handled: true, data: { code: 0, data: {} } }
      }
    },
    '@hzy/foundation/server/utils/serviceOidc': { fetchConsoleServiceJson, trustedServiceRequestHeaders, requestServiceAccessToken: async () => 'unused' },
    '@hzy/foundation/server/utils/serviceAppUrl': { resolveServiceAppBaseUrl: () => 'https://tenant.example.test/console' },
    '@hzy/foundation/server/utils/notify': {},
    '@hzy/foundation/server/utils/cloudflareServiceBinding': {},
    '@hzy/foundation/server/utils/tenantGatewayTrust': { resolveTrustedTenantGatewayContext },
    '@hzy/foundation/server/utils/notificationActionTarget': {},
    '@hzy/foundation/server/utils/subjectEligibility': {},
    './runtimeNotifications': {
      deliverWorkflowRuntimeNotifications: async (_event: H3Event, notifications: RecordValue[]) => {
        published.push(...notifications)
        return notifications.map(notification => ({ idempotencyKey: notification.idempotencyKey, status: statuses[published.length - 1] }))
      }
    },
    './localCallbackContext': loadModule('../../workflow/server/utils/localCallbackContext.ts', {}),
    './runtimeActionableLifecycles': {}
  })
  const drain = client.drainWorkflowNotificationOutbox as (event: H3Event) => Promise<Array<{ effectId: number, status: string }>>
  return { checkpoints, published, drain }
}

test('creation notification drain acks published and skipped effects and retries failures', async () => {
  const client = notificationDrainClient(['published', 'failed', 'skipped'])
  const results = await client.drain(bindingEvent([], () => Response.json({ code: 0 })))
  assert.deepEqual(JSON.parse(JSON.stringify(results.map(item => [item.effectId, item.status]))), [[1, 'published'], [2, 'failed'], [3, 'skipped']])
  assert.deepEqual(client.published.map(item => item.idempotencyKey), ['k1', 'k2', 'k3'])
  assert.deepEqual(client.checkpoints, [
    '/v1/workflow/notification-effects/1/ack',
    '/v1/workflow/notification-effects/2/fail',
    '/v1/workflow/notification-effects/3/ack'
  ])
})

function eligibilityClient(event: H3Event) {
  return loadModule('../server/utils/subjectEligibility.ts', {
    'h3': { getHeader },
    './tenantGatewayTrust': { resolveTrustedTenantGatewayContext },
    './consoleRuntime': {
      getConsoleRuntimeConfig: async () => ({
        app: { appCode: 'workflow' }, tenant: { tenantCode: 'T1' }, deployment: { deploymentCode: 'T1-workflow' }, console: { baseUrl: 'https://tenant.example.test/console' }
      })
    },
    './serviceOidc': {
      fetchConsoleServiceJson,
      requestWithServiceAccessToken: async (request: TokenRequest) => {
        assert.equal(request.audience, 'console')
        assert.equal(request.scope, 'console:authorization:subject-eligibility')
        assert.equal(request.event, event)
        assert.ok(request.request)
        return request.request('eligibility-token')
      }
    }
  }).checkSubjectEligibility as (input: { event: H3Event, subjectUid: string, purpose: string }) => Promise<RecordValue>
}

for (const trusted of [true, false]) {
  test(`eligibility binding removes /console prefix and ${trusted ? 'forwards trusted' : 'omits forged'} gateway headers`, async () => {
    const calls: RequestCall[] = []
    const event = bindingEvent(calls, () => Response.json({ active: true, allowed: true, reason: 'allowed', policyRevision: 1 }), trusted)
    const result = await eligibilityClient(event)({ event, subjectUid: ' user-1 ', purpose: ' task_actionable ' })
    assert.equal(result.allowed, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, 'https://tenant.example.test/api/v1/console/service/authorization/subject-eligibility')
    assertHeaders(calls[0]!, trusted)
    assert.equal(calls[0]!.headers.authorization, 'Bearer eligibility-token')
    assert.deepEqual(calls[0]!.body, { subjectUid: 'user-1', purpose: 'task_actionable' })
  })
}

test('eligibility binding 503 propagates without fabricating an authorization denial', async () => {
  const calls: RequestCall[] = []
  const event = bindingEvent(calls, () => Response.json({ message: 'console_unavailable' }, { status: 503 }))
  await assert.rejects(eligibilityClient(event)({ event, subjectUid: 'user-1', purpose: 'task_actionable' }), {
    statusCode: 503, message: 'console_unavailable'
  })
  assert.equal(calls.length, 1)
})
