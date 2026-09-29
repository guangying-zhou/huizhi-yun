import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { H3Event } from 'h3'
import { trustedNotificationDetailActor } from '../server/utils/tenantRuntimeClient.ts'

const consoleAuth = {
  authenticated: true,
  subjectType: 'service',
  tokenUse: 'service',
  appCode: 'console',
  tenant: 'C000001',
  deployment: 'wiztek-test-console',
  scopes: ['workflow:notification-details:authorize']
}

function event(auth: Record<string, unknown> = consoleAuth) {
  return { context: { consoleAuth: auth } } as unknown as H3Event
}

function call(overrides: {
  auth?: Record<string, unknown>
  delegation?: Record<string, unknown>
  path?: string
  method?: string
  tenant?: string
} = {}) {
  return trustedNotificationDetailActor({
    event: event(overrides.auth),
    path: overrides.path ?? '/v1/workflow/notification-details/authorize',
    tenant: overrides.tenant ?? 'C000001',
    options: {
      appCode: 'workflow',
      method: overrides.method ?? 'POST',
      notificationDetailActor: overrides.delegation ?? { uid: 'test', tenantId: 'C000001', deploymentId: 'wiztek-test-console' }
    } as never
  })
}

describe('trusted notification detail actor', () => {
  test('accepts a Console caller whose deployment differs from the target app deployment', () => {
    // Workflow calls its Runtime under C000001-test-workflow-local; the viewer
    // delegation stays bound to the verified Console deployment.
    assert.equal(call(), 'test')
  })

  test('rejects a delegation that does not match the verified Console token', () => {
    assert.throws(() => call({ delegation: { uid: 'test', tenantId: 'C000001', deploymentId: 'C000001-test-workflow-local' } }), /delegation is invalid/)
    assert.throws(() => call({ delegation: { uid: 'test', tenantId: 'OTHER', deploymentId: 'wiztek-test-console' } }), /delegation is invalid/)
    assert.throws(() => call({ tenant: 'OTHER' }), /delegation is invalid/)
  })

  test('rejects non-Console callers, missing scope and other routes', () => {
    assert.throws(() => call({ auth: { ...consoleAuth, appCode: 'aims' } }), /delegation is invalid/)
    assert.throws(() => call({ auth: { ...consoleAuth, scopes: ['workflow.read'] } }), /delegation is invalid/)
    assert.throws(() => call({ auth: { ...consoleAuth, subjectType: 'user' } }), /delegation is invalid/)
    assert.throws(() => call({ path: '/v1/workflow/instances' }), /delegation is invalid/)
    assert.throws(() => call({ method: 'GET' }), /delegation is invalid/)
    assert.throws(() => call({ delegation: { uid: 'te\nst', tenantId: 'C000001', deploymentId: 'wiztek-test-console' } }), /delegation is invalid/)
  })

  test('returns no delegation when none is requested', () => {
    const result = trustedNotificationDetailActor({
      event: event(),
      path: '/v1/workflow/notification-details/authorize',
      tenant: 'C000001',
      options: { appCode: 'workflow', method: 'POST' } as never
    })
    assert.equal(result, '')
  })
})
