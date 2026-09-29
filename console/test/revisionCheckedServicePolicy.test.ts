import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateWithRevisionCheckedServicePolicy,
  SERVICE_POLICY_MAX_SIGNED_AGE_MS,
  type ServicePolicyBundleIdentity
} from '../server/utils/revisionCheckedServicePolicyCore.ts'

const now = Date.parse('2026-09-25T18:00:00Z')
const identity = { policyRevision: 27, payloadHash: 'hash-27', status: 'active' as const }
function bundle(revision = 27, acceptedAt = now - 60_000): ServicePolicyBundleIdentity {
  return {
    tenantCode: 'C000001', deploymentCode: 'wiztek-test-console', bundleHash: `hash-${revision}`,
    status: 'active', policyValidity: 'valid', cachedAt: new Date(acceptedAt).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    verifiedEnvelope: { body: JSON.stringify({ tenant: 'C000001', policyRevision: revision,
      payloadHash: `hash-${revision}`, status: 'active' }) }
  }
}

function run(overrides: Partial<Parameters<typeof evaluateWithRevisionCheckedServicePolicy<string>>[0]> = {}) {
  let evaluated = 0
  let refreshed = 0
  let probed = 0
  const input = {
    managed: true, tenant: 'C000001', deployment: 'wiztek-test-console', now: () => now,
    evaluate: async () => {
      evaluated++
      return 'allowed'
    },
    read: async () => bundle(),
    probe: async () => {
      probed++
      return identity
    },
    refresh: async () => {
      refreshed++
      return { ok: true, bundle: bundle(27) }
    },
    ...overrides
  }
  return { result: evaluateWithRevisionCheckedServicePolicy(input), counts: () => ({ evaluated, refreshed, probed }) }
}

test('unchanged revision uses the verified bounded-age bundle without fetching a full envelope', async () => {
  const call = run()
  assert.equal(await call.result, 'allowed')
  assert.deepEqual(call.counts(), { evaluated: 1, refreshed: 0, probed: 1 })
})

test('changed revision requires a matching newly verified envelope before evaluation', async () => {
  const call = run({ probe: async () => ({ policyRevision: 28, payloadHash: 'hash-28', status: 'active' }),
    refresh: async () => ({ ok: true, bundle: bundle(28) }) })
  assert.equal(await call.result, 'allowed')
  assert.equal(call.counts().evaluated, 1)
  const mismatch = run({ probe: async () => ({ policyRevision: 28, payloadHash: 'hash-28', status: 'active' }) })
  await assert.rejects(mismatch.result, /revision_checked_service_policy_unavailable/)
  assert.equal(mismatch.counts().evaluated, 0)
})

test('probe failure closes authorization without falling back to stale cache or full fetch', async () => {
  const call = run({ probe: async () => {
    throw Error('platform unavailable')
  } })
  await assert.rejects(call.result, /revision_checked_service_policy_unavailable/)
  assert.equal(call.counts().evaluated, 0)
  assert.equal(call.counts().refreshed, 0)
})

test('role revocation in the next revision denies; stale allow is never evaluated', async () => {
  let roleAllowed = true
  const call = run({ probe: async () => ({ policyRevision: 28, payloadHash: 'hash-28', status: 'active' }),
    refresh: async () => {
      roleAllowed = false
      return { ok: true, bundle: bundle(28) }
    }, evaluate: async () => roleAllowed ? 'allowed' : 'denied' })
  assert.equal(await call.result, 'denied')
  const failed = run({ probe: async () => ({ policyRevision: 28, payloadHash: 'hash-28', status: 'active' }),
    refresh: async () => ({ ok: false, bundle: null }) })
  await assert.rejects(failed.result, /revision_checked_service_policy_unavailable/)
  assert.equal(failed.counts().evaluated, 0)
})

test('signed-age ceiling, grace, inactive status, binding mismatch and rollback fail closed', async () => {
  for (const changed of [
    { cachedAt: new Date(now - SERVICE_POLICY_MAX_SIGNED_AGE_MS).toISOString() },
    { policyValidity: 'grace' as const }, { tenantCode: 'C000002' },
    { deploymentCode: 'other' }, { status: 'revoked' }
  ]) {
    const call = run({ read: async () => ({ ...bundle(), ...changed }), refresh: async () => ({ ok: false, bundle: null }) })
    await assert.rejects(call.result, /revision_checked_service_policy_unavailable/)
    assert.equal(call.counts().evaluated, 0)
  }
  const rollback = run({ probe: async () => ({ policyRevision: 26, payloadHash: 'hash-26', status: 'active' }) })
  await assert.rejects(rollback.result, /revision_checked_service_policy_unavailable/)
  assert.equal(rollback.counts().evaluated, 0)
  const revoked = run({ probe: async () => ({ policyRevision: 28, payloadHash: 'hash-28', status: 'revoked' }) })
  await assert.rejects(revoked.result, /revision_checked_service_policy_unavailable/)
  assert.equal(revoked.counts().evaluated, 0)
})

test('configured signed age is bounded and a shorter limit requires renewal', async () => {
  const expired = run({ maxSignedAgeMs: 90_000, read: async () => bundle(27, now - 100_000),
    refresh: async () => ({ ok: false, bundle: null }) })
  await assert.rejects(expired.result, /revision_checked_service_policy_unavailable/)
  assert.equal(expired.counts().evaluated, 0)
  const renewed = run({ maxSignedAgeMs: 90_000, read: async () => bundle(27, now - 100_000) })
  assert.equal(await renewed.result, 'allowed')
  assert.equal(renewed.counts().refreshed, 1)
  for (const maxSignedAgeMs of [0, 30_000, SERVICE_POLICY_MAX_SIGNED_AGE_MS + 1, Number.NaN]) {
    const invalid = run({ maxSignedAgeMs })
    await assert.rejects(invalid.result, /revision_checked_service_policy_unavailable/)
    assert.equal(invalid.counts().evaluated, 0)
  }
})
