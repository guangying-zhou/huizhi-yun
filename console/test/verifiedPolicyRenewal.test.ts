import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { issuePolicyEnvelope } from '../../platform/server/utils/policyEnvelope.ts'
import { synchronizeVerifiedPolicy, verifiedEnvelopeBundle, verifiedSnapshotBundle } from '../server/utils/verifiedPolicySync.ts'
import {
  POLICY_RENEWAL_INTERVAL_MS, SERVICE_KEY_RENEW_BEFORE_MS, SERVICE_KEY_RETRY_MS, classifyPolicyRenewalFailure, resetServiceKeyAttempts, syncVerifiedPolicy,
  type VerifiedPolicySyncDependencies
} from '../server/utils/verifiedPolicyRenewal.ts'
import type { PolicyEnvelopeBody, PolicyRenewal } from '@hzy/authz-core/policy-envelope'
import type { VerifiedPolicySnapshot } from '@hzy/foundation/server/utils/consoleVerifiedPolicyStore'

const HOUR = 3_600_000
const keys = generateKeyPairSync('ed25519')
const key = { kid: 'fixture', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const base = { issuer: 'https://platform.example', tenant: 'tenant', deployment: 'console-prod' }

async function signed(options: { environment?: 'prod' | 'test', issuedAt?: number, lease?: number, status?: PolicyEnvelopeBody['status'], policyExpiresAt?: number | null } = {}) {
  const environment = options.environment ?? 'prod'
  const issuedAt = options.issuedAt ?? 1_000_000
  const payload = JSON.stringify({ tenant: { tenantCode: base.tenant }, environment, policyRevision: 3,
    deployments: [{ deploymentCode: base.deployment, environment, status: 'active' }] })
  const context = { ...base, environment, maxAgeMs: options.lease ?? HOUR }
  const envelope = await issuePolicyEnvelope({ issuer: base.issuer, tenant: base.tenant, environment, deployments: [base.deployment],
    bundleVersion: 'v3', policyRevision: 3, status: options.status ?? 'active', issuedAt, expiresAt: issuedAt + (options.lease ?? HOUR),
    policyExpiresAt: options.policyExpiresAt ?? null, payload }, { ...context, now: issuedAt },
  async input => ({ kid: key.kid, alg: 'Ed25519', signature: sign(null, Buffer.from(input), keys.privateKey).toString('base64url') }))
  const body = JSON.parse(envelope.body)
  const snapshot = (renewal?: PolicyRenewal | null): VerifiedPolicySnapshot => ({ tenant: base.tenant, environment, deployment: base.deployment, envelope,
    etag: createHash('sha256').update(`${key.kid}\n${envelope.body}\n${envelope.signature}`).digest('hex'),
    acceptedAt: issuedAt + 1, issuedAt, policyRevision: 3, payloadHash: body.payloadHash, renewal })
  return { envelope, snapshot, context }
}

test('only Platform evidence is classified: refusal, outage or invalid response; local failures record nothing', () => {
  const platform = (fields: Record<string, unknown>) => ({ policyStage: 'platform', ...fields })
  for (const status of [400, 401, 403, 404, 409]) assert.equal(classifyPolicyRenewalFailure(platform({ statusCode: status })), 'refused')
  assert.equal(classifyPolicyRenewalFailure(platform({ response: { status: 401 } })), 'refused')
  for (const cause of [platform({ statusCode: 408 }), platform({ statusCode: 429 }), platform({ statusCode: 500 }), platform({ status: 503 }), Object.assign(Error('fetch failed'), { policyStage: 'platform' })]) {
    assert.equal(classifyPolicyRenewalFailure(cause), 'platform_unavailable')
  }
  assert.equal(classifyPolicyRenewalFailure(Object.assign(Error('policy_envelope_invalid'), { policyStage: 'protocol' })), 'invalid')
  for (const cause of [Error('policy_envelope_invalid'), { statusCode: 409 }, { statusCode: 503 }, undefined, null]) {
    assert.equal(classifyPolicyRenewalFailure(cause), null, 'untagged (local) failures are not Platform evidence')
  }
})

test('a tampered envelope from Platform is invalid, never an outage', async () => {
  const { envelope, context } = await signed()
  const tampered = { ...envelope, body: envelope.body.replace('"v3"', '"v4"') }
  let failure: unknown
  try {
    verifiedEnvelopeBundle(tampered, key, { ...context, now: 1_000_010 }, { allowInactive: true })
  } catch (error) {
    // platformRuntime.ts tags this call site as 'protocol' (asserted on its source below).
    failure = Object.assign(error as Error, { policyStage: 'protocol' })
  }
  assert.match(String((failure as Error)?.message), /policy_envelope_invalid/)
  assert.equal(classifyPolicyRenewalFailure(failure), 'invalid')
  const source = readFileSync(new URL('../server/utils/platformRuntime.ts', import.meta.url), 'utf8')
  assert.match(source, /catch \(error\) \{\n {6}throw tagPolicyStage\(error, 'protocol'\)/)
  assert.equal((source.match(/throw tagPolicyStage\(error, 'platform'\)/g) || []).length, 2, 'envelope and probe fetches are tagged')
})

test('prod reads accept the 60-minute lease and serve the last envelope only in outage grace', async () => {
  const { snapshot, context } = await signed()
  const now = (offset: number) => ({ ...context, now: 1_000_000 + offset })
  const valid = verifiedSnapshotBundle(snapshot(null), key, now(HOUR - 1))
  assert.equal(valid.policyValidity, 'valid')
  assert.equal(valid.expiresAt, new Date(1_000_000 + HOUR).toISOString())
  assert.throws(() => verifiedSnapshotBundle(snapshot(null), key, now(HOUR)), /expired/)
  const outage = { state: 'platform_unavailable' as const, attemptedAt: 1_000_000 + HOUR + 60_000 }
  const grace = verifiedSnapshotBundle(snapshot(outage), key, now(HOUR + 120_000))
  assert.equal(grace.policyValidity, 'grace')
  assert.equal(grace.expiresAt, new Date(outage.attemptedAt + 1_800_000).toISOString())
  assert.throws(() => verifiedSnapshotBundle(snapshot({ ...outage, state: 'refused' }), key, now(HOUR + 120_000)), /expired/)
  assert.throws(() => verifiedSnapshotBundle(snapshot(outage), key, now(HOUR + 60_000 + 1_800_000)), /expired/)
  const late = { state: 'platform_unavailable' as const, attemptedAt: 1_000_000 + 86_400_000 - 1000 }
  assert.throws(() => verifiedSnapshotBundle(snapshot(late), key, now(86_400_000)), /expired/)
})

test('a lease longer than 60 minutes is still rejected outside test', async () => {
  const { snapshot, context } = await signed({ environment: 'test', lease: HOUR + 1 })
  assert.equal(verifiedSnapshotBundle(snapshot(null), key, { ...context, maxAgeMs: 93_600_000, now: 1_000_010 }).policyValidity, 'valid')
  assert.throws(() => verifiedSnapshotBundle(snapshot(null), key, { ...context, environment: 'prod', maxAgeMs: HOUR + 1, now: 1_000_010 }))
})

test('a signed suspension is stored by the syncer but never authorizes, even during an outage', async () => {
  const active = await signed()
  const suspended = await signed({ issuedAt: 1_000_500, status: 'suspended' })
  let stored: VerifiedPolicySnapshot = active.snapshot(null)
  const store = {
    async get() { return stored },
    async put(envelope: unknown, etag: string) {
      assert.equal(envelope, suspended.envelope)
      assert.equal(etag, stored.etag)
      stored = suspended.snapshot(null)
      return stored
    }
  }
  await assert.rejects(synchronizeVerifiedPolicy(store, suspended.envelope, key, active.context, () => 1_000_600), /inactive/)
  assert.equal(stored.envelope, suspended.envelope)
  const outage = { state: 'platform_unavailable' as const, attemptedAt: 1_000_500 + HOUR + 10 }
  assert.throws(() => verifiedSnapshotBundle(suspended.snapshot(outage), key, { ...active.context, now: 1_000_500 + HOUR + 20 }), /inactive/)
})

function deps(overrides: Partial<VerifiedPolicySyncDependencies> & { calls?: string[] } = {}): VerifiedPolicySyncDependencies & { calls: string[] } {
  const calls = overrides.calls ?? []
  const body = { policyRevision: 3, payloadHash: 'sha256_a', status: 'active', issuedAt: 1_000_000, expiresAt: 1_000_000 + HOUR } as PolicyEnvelopeBody
  return {
    calls,
    now: () => 1_000_000 + 60_000,
    current: async () => ({ etag: 'etag-1', body }),
    probe: async () => {
      calls.push('probe')
      return { policyRevision: 3, payloadHash: 'sha256_a', status: 'active' }
    },
    refresh: async () => {
      calls.push('refresh')
      return { ok: true, bundle: { generatedAt: new Date(2_000_000).toISOString() } as never, status: {} as never, error: null }
    },
    record: async (state, etag) => { calls.push(`record:${state}:${etag}`) },
    warn: () => { calls.push('warn') },
    ...overrides
  }
}

test('unchanged revision inside the renewal interval records ok without a full fetch', async () => {
  const d = deps()
  assert.deepEqual(await syncVerifiedPolicy(d), { ok: true, mode: 'unchanged', renewAfter: 1_000_000 + POLICY_RENEWAL_INTERVAL_MS })
  assert.deepEqual(d.calls, ['probe', 'record:ok:etag-1'])
})

test('changed revision, status, due renewal or a failed probe all fetch the full envelope', async () => {
  const variants: Partial<VerifiedPolicySyncDependencies>[] = [
    { probe: async () => ({ policyRevision: 4, payloadHash: 'sha256_b', status: 'active' }) },
    { probe: async () => ({ policyRevision: 3, payloadHash: 'sha256_a', status: 'suspended' }) },
    { now: () => 1_000_000 + POLICY_RENEWAL_INTERVAL_MS },
    { probe: async () => { throw Error('unapproved destination') } }
  ]
  for (const variant of variants) {
    const d = deps(variant)
    assert.deepEqual(await syncVerifiedPolicy(d), { ok: true, mode: 'renewed', renewAfter: 2_000_000 + POLICY_RENEWAL_INTERVAL_MS })
    assert.ok(d.calls.includes('refresh'))
    assert.ok(!d.calls.some(call => call.startsWith('record:')), 'a successful write resets renewal itself')
  }
})

const down = async (): Promise<never> => {
  throw Error('down')
}

test('failed renewal records the classified Platform evidence; local failures record nothing', async () => {
  const cases: [unknown, string | null][] = [
    [{ policyStage: 'platform', statusCode: 503 }, 'platform_unavailable'],
    [Object.assign(Error('timeout'), { policyStage: 'platform' }), 'platform_unavailable'],
    [{ policyStage: 'platform', statusCode: 401 }, 'refused'],
    [Object.assign(Error('policy_envelope_invalid'), { policyStage: 'protocol' }), 'invalid'],
    [Object.assign(Error('policy_snapshot_conflict'), { statusCode: 409 }), null]
  ]
  for (const [cause, state] of cases) {
    const d = deps({ probe: down, refresh: async () => ({ ok: false, bundle: null, status: {} as never, error: 'failed', cause }) })
    const result = await syncVerifiedPolicy(d)
    assert.deepEqual(result, { ok: false, mode: 'failed', renewal: state, error: 'failed' })
    assert.equal(d.calls.some(call => call.startsWith('record:')), state !== null)
    if (state) assert.ok(d.calls.includes(`record:${state}:etag-1`))
  }
  const first = deps({ current: async () => null, refresh: async () => ({ ok: false, bundle: null, status: {} as never, error: 'failed', cause: { policyStage: 'platform', statusCode: 503 } }) })
  assert.equal((await syncVerifiedPolicy(first)).ok, false)
  assert.ok(!first.calls.some(call => call.startsWith('record:')), 'no snapshot, nothing to grant grace to')
  const failingRecord = async () => {
    throw Object.assign(Error('conflict'), { statusCode: 409 })
  }
  const unrecorded = deps({ probe: down, refresh: async () => ({ ok: false, bundle: null, status: {} as never, error: 'failed', cause: { policyStage: 'platform', statusCode: 503 } }), record: failingRecord })
  assert.equal((await syncVerifiedPolicy(unrecorded)).ok, false)
  assert.ok(unrecorded.calls.includes('warn'))
  const unchanged = deps({ record: failingRecord })
  assert.deepEqual(await syncVerifiedPolicy(unchanged), { ok: true, mode: 'unchanged', renewAfter: 1_000_000 + POLICY_RENEWAL_INTERVAL_MS })
  assert.ok(unchanged.calls.includes('warn'))
})

test('an explicit probe refusal is decisive and is not replaced by a later fetch outcome', async () => {
  const d = deps({
    probe: async () => {
      throw { policyStage: 'platform', statusCode: 403 }
    },
    refresh: async () => ({ ok: false, bundle: null, status: {} as never, error: 'failed', cause: { policyStage: 'platform', statusCode: 503 } })
  })
  const result = await syncVerifiedPolicy(d)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.renewal, 'refused')
  assert.ok(d.calls.includes('record:refused:etag-1'))
  assert.ok(!d.calls.includes('refresh'), 'the refusal is not overwritten by a later outage')
  for (const probeFailure of [{ policyStage: 'protocol' }, { policyStage: 'platform', statusCode: 503 }]) {
    const fallback = deps({
      probe: async () => {
        throw probeFailure
      }
    })
    assert.deepEqual(await syncVerifiedPolicy(fallback), { ok: true, mode: 'renewed', renewAfter: 2_000_000 + POLICY_RENEWAL_INTERVAL_MS })
  }
})

test('sync endpoint uses the check mode only for the verified backend', () => {
  const source = readFileSync(new URL('../server/api/internal/policy-bundle/sync.post.ts', import.meta.url), 'utf8')
  assert.ok(source.indexOf('if (verifiedPolicyStoreEnabled(event))') < source.indexOf('await refreshPlatformBundle(\'independent-sync\', event)\n  if (localDiagnostic)'))
  assert.match(source, /probe: \(\) => fetchPlatformPolicyRevision\(event\)/)
  const runtime = readFileSync(new URL('../server/utils/verifiedPolicyRuntime.ts', import.meta.url), 'utf8')
  assert.match(runtime, /config\.environment === 'test' \? policyMaxAgeMs\(event\) : POLICY_ENVELOPE_LONG_MAX_AGE_MS/)
  assert.match(runtime, /resetVerifiedPolicyReadCache\(\)\n {4}throw error/)
})

test('a configured service key missing from the envelope is registered and delivered by an immediate full renewal', async () => {
  resetServiceKeyAttempts()
  const key = { kid: 'csk_0123456789abcdef', publicKey: 'A'.repeat(43) }
  const calls: string[] = []
  const d = deps({
    calls,
    serviceKey: async () => key,
    registerServiceKey: async (publicKey) => {
      calls.push(`register:${publicKey === key.publicKey}`)
    }
  })
  assert.deepEqual(await syncVerifiedPolicy(d), { ok: true, mode: 'renewed', renewAfter: 2_000_000 + POLICY_RENEWAL_INTERVAL_MS })
  assert.deepEqual(calls, ['register:true', 'probe', 'refresh'], 'an unchanged revision is still re-fetched so the signed key arrives at once')
  // Attempts are spaced: an envelope still without the key is re-fetched, not re-registered.
  calls.length = 0
  await syncVerifiedPolicy(d)
  assert.deepEqual(calls, ['probe', 'refresh'])
  // Once the retry window passes without delivery, syncs return to the plain probe.
  calls.length = 0
  await syncVerifiedPolicy({ ...d, now: () => 1_060_000 + SERVICE_KEY_RETRY_MS - 1 })
  assert.deepEqual(calls, ['probe', 'refresh'])
  resetServiceKeyAttempts()
  calls.length = 0
  await syncVerifiedPolicy({ ...d, registerServiceKey: async () => false })
  assert.deepEqual(calls, ['probe', 'record:ok:etag-1'], 'no registration path means no extra fetch')
})

test('a signed key with enough lifetime left is not re-registered; one near notAfter is', async () => {
  resetServiceKeyAttempts()
  const key = { kid: 'csk_0123456789abcdef', publicKey: 'A'.repeat(43) }
  const now = 1_000_000 + 60_000
  for (const [notAfter, expected] of [[now + SERVICE_KEY_RENEW_BEFORE_MS + 1, false], [now + SERVICE_KEY_RENEW_BEFORE_MS, true]] as const) {
    resetServiceKeyAttempts()
    const calls: string[] = []
    const body = { policyRevision: 3, payloadHash: 'sha256_a', status: 'active', issuedAt: 1_000_000, expiresAt: 1_000_000 + HOUR,
      serviceKeys: [{ deployment: 'console', kid: key.kid, publicKey: key.publicKey, notAfter }] } as PolicyEnvelopeBody
    await syncVerifiedPolicy(deps({
      calls, current: async () => ({ etag: 'etag-1', body }), serviceKey: async () => key,
      registerServiceKey: async () => {
        calls.push('register')
      }
    }))
    assert.equal(calls.includes('register'), expected, `notAfter ${notAfter}`)
  }
})

test('registration problems never change the renewal outcome', async () => {
  const key = { kid: 'csk_0123456789abcdef', publicKey: 'A'.repeat(43) }
  for (const variant of [
    { registerServiceKey: async () => { throw Object.assign(Error('down'), { statusCode: 503 }) } },
    { registerServiceKey: async () => false },
    { serviceKey: async () => { throw Error('bad key file') } },
    { serviceKey: async () => null }
  ] as Partial<VerifiedPolicySyncDependencies>[]) {
    resetServiceKeyAttempts()
    const calls: string[] = []
    const d = deps({ calls, serviceKey: async () => key, registerServiceKey: async () => undefined, ...variant })
    assert.deepEqual(await syncVerifiedPolicy(d), { ok: true, mode: 'unchanged', renewAfter: 1_000_000 + POLICY_RENEWAL_INTERVAL_MS })
    assert.ok(calls.includes('record:ok:etag-1'))
  }
  resetServiceKeyAttempts()
  const later = deps({
    serviceKey: async () => key,
    registerServiceKey: async () => {
      throw Error('down')
    },
    now: () => 1_060_000
  })
  await syncVerifiedPolicy(later)
  const retry: string[] = []
  await syncVerifiedPolicy(deps({ calls: retry, serviceKey: async () => key, now: () => 1_060_000 + SERVICE_KEY_RETRY_MS,
    registerServiceKey: async () => {
      retry.push('register')
    } }))
  assert.ok(retry.includes('register'), 'a failed registration is retried after the spacing interval')
})

test('a failed full re-fetch after registration is classified and recorded', async () => {
  for (const [cause, expected] of [
    [{ policyStage: 'platform', statusCode: 503 }, 'platform_unavailable'],
    [{ policyStage: 'platform', statusCode: 403 }, 'refused'],
    [{ policyStage: 'protocol' }, 'invalid']
  ] as const) {
    resetServiceKeyAttempts()
    const calls: string[] = []
    const d = deps({
      calls,
      serviceKey: async () => ({ kid: 'csk_0123456789abcdef', publicKey: 'A'.repeat(43) }),
      registerServiceKey: async () => undefined,
      refresh: async () => {
        calls.push('refresh')
        return { ok: false, bundle: null, status: {} as never, error: 'refresh-failed', cause }
      }
    })
    assert.deepEqual(await syncVerifiedPolicy(d), { ok: false, mode: 'failed', renewal: expected, error: 'refresh-failed' })
    assert.deepEqual(calls, ['probe', 'refresh', `record:${expected}:etag-1`])
  }
})
