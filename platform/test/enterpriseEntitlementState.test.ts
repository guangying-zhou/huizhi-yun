import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transitionEnterpriseEntitlement } from '../server/utils/enterpriseEntitlementState.ts'
import { requireEnterpriseEntitlementStateAccess, parseEnterpriseStateRequest } from '../server/utils/enterpriseEntitlementStateAccess.ts'
import type { EnterpriseEntitlement } from '../server/utils/enterpriseEntitlement.ts'

const entitlement: EnterpriseEntitlement = { schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', tenantCode: 't1', revision: 1, status: 'active', effectiveFrom: '2026-01-01T00:00:00.000Z', end: { kind: 'finite', effectiveUntil: '2027-01-01T00:00:00.000Z' } }
const now = '2026-09-13T00:00:00Z'
test('suspend and restore preserve original periods and increment revisions', () => {
  const suspended = transitionEnterpriseEntitlement(entitlement, 'suspend', now)
  assert.equal(suspended.status, 'suspended')
  assert.equal(suspended.revision, 2)
  const restored = transitionEnterpriseEntitlement(suspended, 'restore', now)
  assert.equal(restored.status, 'active')
  assert.equal(restored.revision, 3)
  assert.deepEqual(restored.end, entitlement.end)
  assert.equal(restored.effectiveFrom, entitlement.effectiveFrom)
})
test('expired suspended qualification restores to expired, never extended', () => {
  const suspended = transitionEnterpriseEntitlement(entitlement, 'suspend', now)
  const restored = transitionEnterpriseEntitlement(suspended, 'restore', '2027-01-01T00:00:00Z')
  assert.equal(restored.status, 'expired')
  assert.deepEqual(restored.end, entitlement.end)
})
test('revocation is terminal and cannot become suspension or restored access', () => {
  const revoked = transitionEnterpriseEntitlement(entitlement, 'revoke', now)
  assert.equal(revoked.status, 'revoked')
  for (const action of ['restore', 'suspend', 'revoke'] as const) assert.throws(() => transitionEnterpriseEntitlement(revoked, action, now), /entitlement_revoked/)
})
test('normal active and expired qualifications cannot be restored as renewal', () => {
  assert.throws(() => transitionEnterpriseEntitlement(entitlement, 'restore', now), /entitlement_not_suspended/)
  assert.throws(() => transitionEnterpriseEntitlement(entitlement, 'suspend', '2027-01-01T00:00:00Z'), /entitlement_not_suspendable/)
})
test('access requires authenticated ops scope and explicit existing subscription admin', async () => {
  let called = false
  const load = async () => {
    called = true
    return { resources: { 'ops.subscriptions': ['admin'] } }
  }
  await assert.rejects(requireEnterpriseEntitlementStateAccess({}, load), { statusCode: 401 })
  assert.equal(called, false)
  await assert.rejects(requireEnterpriseEntitlementStateAccess({ platformUid: 'u1', platformAccessScope: 'tenant_admin' }, load), { statusCode: 403 })
  assert.equal(called, false)
  for (const actions of [[], ['view'], ['edit'], ['confirm']]) {
    await assert.rejects(requireEnterpriseEntitlementStateAccess({ platformUid: 'u1', platformAccessScope: 'ops' }, async () => ({ resources: { 'ops.subscriptions': actions } })), { statusCode: 403 })
  }
  assert.equal(await requireEnterpriseEntitlementStateAccess({ platformUid: 'u1', platformAccessScope: 'ops' }, load), 'u1')
})
test('authorization dependency failures propagate, never become permission success', async () => {
  await assert.rejects(requireEnterpriseEntitlementStateAccess({ platformUid: 'u1', platformAccessScope: 'ops' }, async () => {
    throw new Error('policy_down')
  }), /policy_down/)
})

test('management body cannot override actor, tenant, period or revision type', () => {
  const body = { action: 'restore', operationId: 'op1', expectedRevision: 2, reason: 'restore agreed service' }
  assert.deepEqual(parseEnterpriseStateRequest(body, 'trusted-tenant', 'trusted-actor'), { ...body, tenantCode: 'trusted-tenant', actorUid: 'trusted-actor' })
  for (const overrides of [{ tenantCode: 'other' }, { actorUid: 'other' }, { effectiveUntil: '2099-01-01' }, { expectedRevision: '2' }]) {
    assert.throws(() => parseEnterpriseStateRequest({ ...body, ...overrides }, 'trusted-tenant', 'trusted-actor'), { statusCode: 400 })
  }
})
