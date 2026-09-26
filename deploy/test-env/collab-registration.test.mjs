import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCollabRegistration, collabGrantMatches, collabGrantScope, collabRegistrationPlan, verifyCollabRegistration } from './collab-registration.mjs'

// Minimal in-memory stand-in for the two Console tables the script touches.
function fakeConsole({ services = [], grants = [] } = {}) {
  const state = { services: structuredClone(services), grants: structuredClone(grants), committed: false, rolledBack: false }
  return {
    state,
    async beginTransaction() {},
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    async query(sql, params = []) {
      if (/^SELECT id,app_code,status FROM service_clients/.test(sql)) return [state.services.filter(s => s.client_code === 'collab.runtime')]
      if (/^INSERT INTO service_clients/.test(sql)) { state.services.push({ id: 7, client_code: 'collab.runtime', app_code: 'collab', status: 'active' }); return [{}] }
      if (/^SELECT id FROM service_clients/.test(sql)) return [[state.services.find(s => s.client_code === 'collab.runtime')]]
      if (/^SELECT status,scope_json FROM service_client_grants/.test(sql)) return [state.grants.filter(g => g.service_client_id === params[0] && g.resource_code === params[1] && g.action === params[2])]
      if (/^INSERT INTO service_client_grants/.test(sql)) { state.grants.push({ service_client_id: params[0], resource_code: params[1], action: params[2], scope_json: params[3], status: 'active' }); return [{}] }
      if (/^SELECT client_code,app_code,status/.test(sql)) return [state.services.filter(s => s.client_code === 'collab.runtime').map(s => ({ ...s, hasCurrentCredential: 0 }))]
      if (/^SELECT g.resource_code/.test(sql)) return [state.grants.map(g => ({ ...g }))]
      throw new Error(`unexpected query: ${sql}`)
    }
  }
}

test('plan grants only the two manifest-declared collaboration capabilities to collab.runtime', () => {
  assert.equal(collabRegistrationPlan.serviceClient, 'collab.runtime')
  assert.equal(collabRegistrationPlan.appCode, 'collab')
  assert.equal(collabRegistrationPlan.audience, 'data-runtime')
  assert.deepEqual(collabRegistrationPlan.capabilities, ['codocs:collaboration-snapshots:read', 'codocs:collaboration-snapshots:publish'])
  assert.equal(collabRegistrationPlan.credentialIssued, false)
})

test('grant scope binds tenant, collab deployment, audience and the exact capability', () => {
  const capability = 'codocs:collaboration-snapshots:publish'
  const scope = collabGrantScope(capability)
  assert.equal(collabGrantMatches(scope, capability), true)
  for (const changed of [{ tenantCode: 'OTHER' }, { deploymentCode: 'C000001-test-enterprise' }, { audience: 'tenant-runtime' }, { semanticScope: 'codocs:collaboration-snapshots:read' }]) {
    assert.equal(collabGrantMatches({ ...scope, ...changed }, capability), false, JSON.stringify(changed))
  }
})

test('apply creates the client and exact grants once; verify then reports nothing missing', async () => {
  const db = fakeConsole()
  await applyCollabRegistration(db)
  await applyCollabRegistration(db)
  assert.equal(db.state.services.length, 1)
  assert.equal(db.state.grants.length, 2)
  const report = await verifyCollabRegistration(db)
  assert.deepEqual(report.missingCapabilities, [])
  assert.deepEqual(report.unexpectedActiveCapabilities, [])
  assert.equal(report.serviceClientActive, true)
  assert.equal(report.tokenIssuanceVerified, false)
})

test('apply never reactivates revoked grants or widens a conflicting scope', async () => {
  const service = { id: 7, client_code: 'collab.runtime', app_code: 'collab', status: 'active' }
  const revoked = fakeConsole({ services: [service], grants: [{ service_client_id: 7, resource_code: 'codocs:collaboration-snapshots', action: 'read', scope_json: JSON.stringify(collabGrantScope('codocs:collaboration-snapshots:read')), status: 'revoked' }] })
  await assert.rejects(applyCollabRegistration(revoked), /GRANT_REVOKED/)
  assert.equal(revoked.state.rolledBack, true)
  const conflicting = fakeConsole({ services: [service], grants: [{ service_client_id: 7, resource_code: 'codocs:collaboration-snapshots', action: 'read', scope_json: JSON.stringify({ ...collabGrantScope('codocs:collaboration-snapshots:read'), deploymentCode: 'other' }), status: 'active' }] })
  await assert.rejects(applyCollabRegistration(conflicting), /GRANT_SCOPE_CONFLICT/)
  const wrongApp = fakeConsole({ services: [{ ...service, app_code: 'console' }] })
  await assert.rejects(applyCollabRegistration(wrongApp), /SERVICE_STATE_CONFLICT/)
})
