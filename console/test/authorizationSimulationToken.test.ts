import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inspectAuthorizationSimulationToken,
  signAuthorizationSimulationToken,
  verifyAuthorizationSimulationToken,
  type AuthorizationSimulationTokenPayload
} from '../server/utils/authorizationSimulationToken.ts'

function payload(overrides: Partial<AuthorizationSimulationTokenPayload> = {}): AuthorizationSimulationTokenPayload {
  return {
    v: 1,
    sid: 'asim_test',
    actorUid: 'u1',
    mode: 'role_simulation',
    roleCode: 'finance',
    subjectCode: null,
    includeBaseline: true,
    reason: '验证财务角色',
    policyBundleVersion: 'pb-20260620',
    policyBundleHash: 'hash-20260620',
    issuedAt: '2026-06-20T00:00:00.000Z',
    expiresAt: '2026-06-20T00:30:00.000Z',
    exp: 1_782_000_000,
    ...overrides
  }
}

test('authorization simulation token：签名后可验证', () => {
  const token = signAuthorizationSimulationToken(payload(), 'secret')
  const verified = verifyAuthorizationSimulationToken(token, 'secret', 1_781_999_000_000)
  const inspection = inspectAuthorizationSimulationToken(token, 'secret', 1_781_999_000_000)

  assert.equal(verified?.sid, 'asim_test')
  assert.equal(verified?.actorUid, 'u1')
  assert.equal(verified?.mode, 'role_simulation')
  assert.equal(verified?.roleCode, 'finance')
  assert.equal(verified?.policyBundleVersion, 'pb-20260620')
  assert.equal(verified?.policyBundleHash, 'hash-20260620')
  assert.equal(inspection.valid, true)
  if (inspection.valid) {
    assert.equal(inspection.payload.sid, 'asim_test')
    assert.equal(inspection.payload.policyBundleVersion, 'pb-20260620')
    assert.equal(inspection.payload.policyBundleHash, 'hash-20260620')
  }
})

test('authorization simulation token：支持用户模拟载荷', () => {
  const token = signAuthorizationSimulationToken(payload({
    mode: 'user_simulation',
    roleCode: null,
    subjectCode: 'u2',
    reason: '排查用户权限'
  }), 'secret')
  const verified = verifyAuthorizationSimulationToken(token, 'secret', 1_781_999_000_000)

  assert.equal(verified?.mode, 'user_simulation')
  assert.equal(verified?.roleCode, null)
  assert.equal(verified?.subjectCode, 'u2')
})

test('authorization simulation token：签名被篡改后不可验证', () => {
  const token = signAuthorizationSimulationToken(payload(), 'secret')
  const [body, signature] = token.split('.')
  const tamperedBody = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}`
  const tampered = `${tamperedBody}.${signature}`
  const inspection = inspectAuthorizationSimulationToken(tampered, 'secret', 1_781_999_000_000)

  assert.equal(verifyAuthorizationSimulationToken(tampered, 'secret', 1_781_999_000_000), null)
  assert.equal(verifyAuthorizationSimulationToken(token, 'other-secret', 1_781_999_000_000), null)
  assert.equal(inspection.valid, false)
  if (!inspection.valid) {
    assert.equal(inspection.reason, 'invalid_signature')
    assert.equal(inspection.payload, undefined)
  }
})

test('authorization simulation token：过期后不可验证', () => {
  const token = signAuthorizationSimulationToken(payload({ exp: 100 }), 'secret')
  const inspection = inspectAuthorizationSimulationToken(token, 'secret', 100_000)

  assert.equal(verifyAuthorizationSimulationToken(token, 'secret', 100_000), null)
  assert.equal(inspection.valid, false)
  if (!inspection.valid) {
    assert.equal(inspection.reason, 'expired')
    assert.equal(inspection.payload?.sid, 'asim_test')
    assert.equal(inspection.payload?.mode, 'role_simulation')
    assert.equal(inspection.payload?.policyBundleVersion, 'pb-20260620')
    assert.equal(inspection.payload?.policyBundleHash, 'hash-20260620')
  }
})
