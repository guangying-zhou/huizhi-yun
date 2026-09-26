import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { verifyRuntimePolicySnapshot } from '../server/utils/verifiedPolicySnapshot.ts'

const fixture = JSON.parse(readFileSync(new URL('../../data-runtime/internal/policyenvelope/testdata/platform-envelope.json', import.meta.url), 'utf8'))
const key = { kid: fixture.envelope.kid, publicKey: fixture.publicKey }
const body = JSON.parse(fixture.envelope.body)
const snapshot = { tenant: fixture.context.tenant, environment: fixture.context.environment, deployment: fixture.context.deployment, envelope: fixture.envelope,
  etag: createHash('sha256').update(`${fixture.envelope.kid}\n${fixture.envelope.body}\n${fixture.envelope.signature}`).digest('hex'),
  acceptedAt: 1000010, policyRevision: body.policyRevision, issuedAt: body.issuedAt, payloadHash: body.payloadHash }
const context = { ...fixture.context, now: 1000020 }

test('Host verifies complete envelope and bounds the cached result by signed expiry', () => {
  const result = verifyRuntimePolicySnapshot(snapshot, key, context)
  assert.equal(result.body.bundleVersion, 'pv_test_12')
  assert.equal(result.validUntil, 1300000)
  assert.equal(result.payload.label, '企业策略 < & >')
})
test('Runtime state must match signed contents and current clock', () => {
  for (const patch of [{ tenant: 'other' }, { environment: 'prod' }, { deployment: 'other' }, { etag: 'other' }, { policyRevision: 1 }, { issuedAt: 0 }, { payloadHash: 'other' },
    { acceptedAt: context.now + 1 }, { acceptedAt: body.issuedAt - 1 }]) {
    assert.throws(() => verifyRuntimePolicySnapshot({ ...snapshot, ...patch }, key, context))
  }
  assert.throws(() => verifyRuntimePolicySnapshot(snapshot, key, { ...context, now: 1300000 }))
})
test('neither browser-supplied metadata nor old HMAC data can substitute for an authentic envelope', () => {
  assert.throws(() => verifyRuntimePolicySnapshot({ ...snapshot, envelope: { ...snapshot.envelope, body: '{}' } }, key, context))
  assert.throws(() => verifyRuntimePolicySnapshot({ ...snapshot, envelope: { body: '{}', mac: 'legacy' } as never }, key, context))
  assert.throws(() => verifyRuntimePolicySnapshot(snapshot, key, { ...context, tenant: 'other' }))
})
