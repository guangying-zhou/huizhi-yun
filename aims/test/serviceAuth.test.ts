import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import type { H3Event } from 'h3'
import { requireServiceScope } from '../server/utils/serviceAuth.ts'

const requirement = { scope: 'aims:service-ticket:work-item:create', allowedApps: ['altoc'] }
const validAuth = {
  authenticated: true,
  tokenUse: 'service',
  subjectType: 'service',
  appCode: 'altoc',
  clientCode: 'altoc.runtime',
  scopes: [requirement.scope]
}

function eventWith(consoleAuth: Record<string, unknown>) {
  return { context: { consoleAuth } } as unknown as H3Event
}

function assertRejectedBeforeHandler(consoleAuth: Record<string, unknown>, statusCode: number, customRequirement = requirement) {
  let calls = 0
  assert.throws(() => {
    requireServiceScope(eventWith(consoleAuth), customRequirement)
    calls += 1
  }, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    return true
  })
  assert.equal(calls, 0)
}

describe('Aims service auth failure classification', () => {
  test('maps invalid, expired, and revoked service identity to 401 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'invalid_token' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'invalid_audience' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'tenant_mismatch' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'deployment_mismatch' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'token_expired' }, 401)
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'revoked_service_token' }, 401)
  })

  test('accepts only Altoc with the exact opportunity project capability', () => {
    const opportunityRequirement = { scope: 'aims:project:create-from-opportunity', allowedApps: ['altoc'] }
    assert.deepEqual(requireServiceScope(eventWith({
      ...validAuth,
      scopes: [opportunityRequirement.scope]
    }), opportunityRequirement), { sourceApp: 'altoc' })
    assertRejectedBeforeHandler({ ...validAuth, scopes: ['aims:write'] }, 403, opportunityRequirement)
    assertRejectedBeforeHandler({ ...validAuth, appCode: 'finance', scopes: [opportunityRequirement.scope] }, 403, opportunityRequirement)
  })

  test('routes the opportunity bridge through the exact BFF requirement', async () => {
    const middleware = await readFile(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
    assert.match(middleware, /from-opportunity[^]*aims:project:create-from-opportunity/)
    assert.match(middleware, /aims:project:create-from-opportunity', allowedApps: \['altoc'\]/)
  })

  test('maps missing capability and wrong source to 403 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, scopes: [] }, 403)
    assertRejectedBeforeHandler({ ...validAuth, appCode: 'finance' }, 403)
    assertRejectedBeforeHandler({ ...validAuth, appCode: '', clientCode: '' }, 403)
  })

  test('preserves Console introspection outages as 503 before handler', () => {
    assertRejectedBeforeHandler({ ...validAuth, authenticated: false, reason: 'service_token_introspection_unavailable' }, 503)
  })

  test('allows any enrolled service caller for a capability-only external feed', () => {
    const genericRequirement = { scope: 'aims:tasks:read' }
    assert.deepEqual(requireServiceScope(eventWith({
      ...validAuth,
      appCode: 'orca',
      clientCode: 'orca.runtime',
      scopes: [genericRequirement.scope]
    }), genericRequirement), { sourceApp: 'orca' })
  })
})
