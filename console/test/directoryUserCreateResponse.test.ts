import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryUserCreateResponse, ldapUserCreateResponse } from '../server/utils/directoryUserCreateResponse'

test('LDAP complete, incomplete and absent activation credentials always use a public response', () => {
  for (const credential of [{ activationToken: 'fixture-token' }, { activationCredentialId: 'fixture-id' }, { activationToken: 'fixture-token', activationCredentialId: 'fixture-id' }, {}]) {
    const result = ldapUserCreateResponse({
      code: 0, token: 'fixture-top-secret', message: 'fixture-private-error', replayed: true,
      data: { uid: 'fixture-user', operationId: 'fixture-operation', status: 'pending', ...credential, internalUrl: 'fixture-private-url', nested: { secret: 'fixture-nested-secret' } }
    }, true)
    assert.deepEqual(result, { code: 0, data: { uid: 'fixture-user', operationId: 'fixture-operation', status: 'pending', activationDelivered: true }, replayed: true })
    assert.doesNotMatch(JSON.stringify(result), /fixture-token|fixture-id|fixture-top-secret|fixture-private|fixture-nested/)
  }
})

test('one-time generated LDAP password remains available only outside activation mode', () => {
  const data = { uid: 'fixture-user', initialPasswordGenerated: true, initialPassword: 'fixture-one-time-password' }
  assert.equal(ldapUserCreateResponse({ data }).data.initialPassword, data.initialPassword)
  for (const activation of [{ activationToken: 'fixture-token' }, { activationCredentialId: 'fixture-id' }, { activationExpiresAt: 'fixture-expiry' }]) {
    assert.equal(ldapUserCreateResponse({ data: { ...data, ...activation } }).data.initialPassword, undefined)
  }
  assert.equal(ldapUserCreateResponse({ data: { ...data, initialPasswordGenerated: false } }).data.initialPassword, undefined)
})

test('directory create strips arbitrary fields and nested values even under known keys', () => {
  assert.deepEqual(directoryUserCreateResponse({ uid: 'fixture-user', id: 3, realName: 'Fixture', email: { secret: 'fixture-private' }, secret: 'fixture-secret', status: 1 }), {
    uid: 'fixture-user', id: 3, realName: 'Fixture', status: 1
  })
  assert.equal(directoryUserCreateResponse(null), null)
})
