import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveLocalServiceTokenSubject,
  serviceTokenCredentialIsActive,
  serviceTokenScopesRemainActive,
  serviceTokenVerificationIsInactive
} from '../server/utils/serviceTokenStatus.ts'

const activeCredential = {
  serviceClientStatus: 'active',
  currentCredentialId: 7,
  credentialId: 7,
  credentialStatus: 'active',
  expiresAt: '2026-07-10T13:00:00.000Z'
}

test('service token remains active only for the current active unexpired credential', () => {
  const now = new Date('2026-07-10T12:00:00.000Z').getTime()
  assert.equal(serviceTokenCredentialIsActive(activeCredential, now), true)
  assert.equal(serviceTokenCredentialIsActive({ ...activeCredential, serviceClientStatus: 'revoked' }, now), false)
  assert.equal(serviceTokenCredentialIsActive({ ...activeCredential, credentialStatus: 'revoked' }, now), false)
  assert.equal(serviceTokenCredentialIsActive({ ...activeCredential, currentCredentialId: 8 }, now), false)
  assert.equal(serviceTokenCredentialIsActive({ ...activeCredential, expiresAt: '2026-07-10T12:00:00.000Z' }, now), false)
})

test('introspection treats only explicit 401 as inactive and surfaces control-plane failures', () => {
  assert.equal(serviceTokenVerificationIsInactive({ statusCode: 401 }), true)
  assert.equal(serviceTokenVerificationIsInactive({ response: { status: 401 } }), true)
  assert.equal(serviceTokenVerificationIsInactive({ statusCode: 500 }), false)
  assert.equal(serviceTokenVerificationIsInactive(new Error('database unavailable')), false)
})

test('revoking any scope carried by a service token makes the token inactive', () => {
  const grants = [
    { resourceCode: 'altoc:service_ticket:delivery-result', action: 'sync' },
    { resourceCode: 'altoc', action: 'read' }
  ]
  assert.equal(serviceTokenScopesRemainActive(
    'altoc:service_ticket:delivery-result:sync altoc:read',
    grants
  ), true)
  assert.equal(serviceTokenScopesRemainActive(
    'altoc:service_ticket:delivery-result:sync altoc:admin',
    grants
  ), false)
  assert.equal(serviceTokenScopesRemainActive('', grants), false)
})

test('Console local issuer uses the real current credential and active grants', () => {
  const now = new Date('2026-07-10T12:00:00.000Z').getTime()
  const credential = {
    ...activeCredential,
    serviceClientId: 3,
    clientId: 'console-runtime-client-id',
    clientCode: 'console.runtime',
    clientName: 'Console Runtime',
    clientType: 'runtime',
    appCode: 'console'
  }
  const grants = [{ resourceCode: 'workflow', action: 'proxy' }]
  const resolved = resolveLocalServiceTokenSubject(credential, 'workflow:proxy', grants, now)

  assert.deepEqual(resolved, {
    ok: true,
    serviceClient: {
      clientId: 'console-runtime-client-id',
      clientCode: 'console.runtime',
      clientName: 'Console Runtime',
      clientType: 'runtime',
      appCode: 'console',
      credentialId: 7
    }
  })
  assert.deepEqual(resolveLocalServiceTokenSubject(
    { ...credential, currentCredentialId: 8 },
    'workflow:proxy',
    grants,
    now
  ), { ok: false, reason: 'credential_inactive' })
  assert.deepEqual(resolveLocalServiceTokenSubject(
    credential,
    'workflow:proxy',
    [],
    now
  ), { ok: false, reason: 'grant_inactive' })
})
