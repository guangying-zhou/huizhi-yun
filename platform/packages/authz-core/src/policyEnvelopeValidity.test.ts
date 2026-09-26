import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  POLICY_ENVELOPE_LONG_MAX_AGE_MS,
  POLICY_ENVELOPE_OUTAGE_GRACE_MS,
  POLICY_ENVELOPE_RENEWAL_LIVENESS_MS,
  evaluatePolicyEnvelopeValidity,
  type PolicyRenewal
} from './policy-envelope.ts'

// Shared with data-runtime/internal/policyenvelope EvaluateValidity: both
// languages must produce identical verdicts for every vector.
const vectors = JSON.parse(readFileSync(new URL('../../../../data-runtime/internal/policyenvelope/testdata/validity-vectors.json', import.meta.url), 'utf8'))

test('validity constants match the shared TS/Go vectors', () => {
  assert.equal(POLICY_ENVELOPE_LONG_MAX_AGE_MS, vectors.constants.longMaxAgeMs)
  assert.equal(POLICY_ENVELOPE_OUTAGE_GRACE_MS, vectors.constants.outageGraceMs)
  assert.equal(POLICY_ENVELOPE_RENEWAL_LIVENESS_MS, vectors.constants.renewalLivenessMs)
  assert.ok(POLICY_ENVELOPE_OUTAGE_GRACE_MS > POLICY_ENVELOPE_LONG_MAX_AGE_MS)
})

for (const vector of vectors.cases) {
  test(`validity vector: ${vector.name}`, () => {
    assert.deepEqual(evaluatePolicyEnvelopeValidity(vector.body, vector.renewal as PolicyRenewal | null, vector.now), vector.expect)
  })
}

test('non-integer timing fails closed', () => {
  const body = { status: 'active' as const, issuedAt: 1000000, expiresAt: 4600000, policyExpiresAt: null }
  assert.deepEqual(evaluatePolicyEnvelopeValidity(body, null, Number.NaN), { verdict: 'expired', validUntil: null })
  assert.deepEqual(evaluatePolicyEnvelopeValidity({ ...body, expiresAt: 1.5 }, null, 1000001), { verdict: 'expired', validUntil: null })
  assert.deepEqual(evaluatePolicyEnvelopeValidity(body, { state: 'platform_unavailable', attemptedAt: 4650000.5 }, 4660000), { verdict: 'expired', validUntil: null })
})
