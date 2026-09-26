import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { canonicalPolicy, inspectPolicyRecord } from '../inspect-policy-contract.mjs'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const options = { publicKey, kid: 'fixture', remoteKey: 'fixture-remote', localKey: 'fixture-local', now: 1000000 }
function fixture() {
  const payload = { tenant: { tenantCode: 'C000001' }, environment: 'test', policyRevision: 12, roles: [] }
  const canonical = JSON.stringify(canonicalPolicy(payload))
  const record = { scope: 'managed-cloud-console:test:C000001', syncedAt: options.now - 1000,
    value: { tenantCode: 'C000001', bundleVersion: 'pv_test_fixture', bundleHash: `sha256_${createHash('sha256').update(canonical).digest('hex')}`,
      status: 'active', expiresAt: null, cachedAt: new Date(options.now - 1000).toISOString(),
      kid: options.kid, alg: 'Ed25519', signature: sign(null, Buffer.from(canonical), privateKey).toString('base64url'), payload } }
  const body = JSON.stringify(record)
  return { body, mac: createHmac('sha256', options.remoteKey).update(body).digest('hex') }
}
function inspect(envelope, overrides = {}) { return inspectPolicyRecord(JSON.stringify(envelope), { ...options, ...overrides }) }

test('valid Platform payload does not make a different local HMAC key valid', () => {
  const result = inspect(fixture())
  assert.equal(result.signatureValid, true)
  assert.equal(result.payloadHashMatches, true)
  assert.equal(result.remoteMacMatches, true)
  assert.equal(result.localMacMatches, false)
})

test('outer version, status, expiry and sync time are NOT covered by the current payload signature', () => {
  for (const mutate of [
    record => { record.value.bundleVersion = 'invented' },
    record => { record.value.status = 'suspended' },
    record => { record.value.expiresAt = '2099-01-01T00:00:00Z' },
    record => { record.syncedAt += 500; record.value.cachedAt = new Date(record.syncedAt).toISOString() }
  ]) {
    const envelope = fixture(), record = JSON.parse(envelope.body)
    mutate(record); envelope.body = JSON.stringify(record)
    const result = inspect(envelope)
    assert.equal(result.signatureValid, true)
    assert.equal(result.payloadHashMatches, true)
    assert.equal(result.remoteMacMatches, false)
  }
})

test('payload changes are detected independently by hash, signature and envelope MAC', () => {
  const envelope = fixture(), record = JSON.parse(envelope.body)
  record.value.payload.policyRevision++
  envelope.body = JSON.stringify(record)
  const result = inspect(envelope)
  assert.equal(result.signatureValid, false)
  assert.equal(result.payloadHashMatches, false)
  assert.equal(result.remoteMacMatches, false)
})

test('valid signatures do not override freshness or pinned signing key', () => {
  assert.equal(inspect(fixture(), { now: options.now + 93600000 }).withinTestWindow, false)
  assert.equal(inspect(fixture(), { now: options.now - 1001 }).withinTestWindow, false)
  assert.equal(inspect(fixture(), { kid: 'unapproved' }).signatureValid, false)
  const wrong = generateKeyPairSync('ed25519')
  assert.equal(inspect(fixture(), { publicKey: wrong.publicKey }).signatureValid, false)
})

test('a validly signed other tenant/environment does not satisfy the local binding', () => {
  const envelope = fixture(), record = JSON.parse(envelope.body)
  record.value.payload.tenant.tenantCode = 'other'
  record.value.payload.environment = 'prod'
  const payload = JSON.stringify(canonicalPolicy(record.value.payload))
  record.value.signature = sign(null, Buffer.from(payload), privateKey).toString('base64url')
  envelope.body = JSON.stringify(record)
  const result = inspect(envelope)
  assert.equal(result.signatureValid, true)
  assert.equal(result.tenantMatches, false)
  assert.equal(result.environmentMatches, false)
})
