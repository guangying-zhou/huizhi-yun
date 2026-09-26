import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PolicyEnvelopeRefusal, cachedCurrentPolicyPayload, deliverCurrentPolicyEnvelope, describeCurrentPolicyRevision, stableStringifyPolicyPayload } from '../server/utils/policyEnvelopeDelivery.ts'
import { policyPayloadHash, verifyPolicyEnvelope } from '../packages/authz-core/src/policy-envelope.ts'

const keys = generateKeyPairSync('ed25519')
const key = { kid: 'test', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const context = { issuer: 'https://platform.example', tenant: 'tenant-1', environment: 'test', deployment: 'console-test', now: 1000000 }
const payload = JSON.stringify({ tenant: { tenantCode: context.tenant }, environment: 'test', policyRevision: 12,
  deployments: ['console-test', 'enterprise-test'].map(deploymentCode => ({ deploymentCode, environment: 'test', status: 'active' })) })
const row = { ...context, bundleVersion: 'bundle-12', policyRevision: 12, status: 'active', payload, payloadHash: policyPayloadHash(payload), policyExpiresAt: null,
  tenantStatus: 'active', deploymentStatus: 'active' }
const signer = async (input: string) => ({ kid: key.kid, alg: 'Ed25519', signature: sign(null, Buffer.from(input), keys.privateKey).toString('base64url') })

test('formal delivery signs current row without changing payload/version on renewal', async () => {
  const deps = { current: async () => row, sign: signer }
  const first = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(context, deps), key, context)
  const later = { ...context, now: context.now + 1000, deployment: 'enterprise-test' }
  const envelope = await deliverCurrentPolicyEnvelope({ ...context, now: later.now }, deps)
  const next = verifyPolicyEnvelope(envelope, key, later)
  assert.equal(next.payload, first.payload)
  assert.equal(next.bundleVersion, first.bundleVersion)
  assert.equal(next.issuedAt, later.now)
  assert.equal(next.expiresAt - next.issuedAt, 300000)
})

test('explicit test-only lease can be extended but never past source expiry', async () => {
  const extended = { ...context, maxAgeMs: 93_600_000 }
  const deps = { current: async () => row, sign: signer }
  const body = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(extended, deps), key, extended)
  assert.equal(body.expiresAt - body.issuedAt, 93_600_000)
  const bounded = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(extended, {
    ...deps, current: async () => ({ ...row, policyExpiresAt: context.now + 60_000 })
  }), key, extended)
  assert.equal(bounded.expiresAt, context.now + 60_000)
  await assert.rejects(deliverCurrentPolicyEnvelope({ ...extended, environment: 'prod' }, deps))
})

test('missing/revoked/expired/mismatched latest row cannot be renewed', async () => {
  for (const value of [null, { ...row, status: 'revoked' }, { ...row, tenant: 'other' },
    { ...row, environment: 'prod' }, { ...row, deployment: 'other' }, { ...row, payloadHash: 'forged' },
    { ...row, policyExpiresAt: context.now }, { ...row, policyRevision: 13 }, { ...row, deploymentStatus: 'disabled' }]) {
    let called = false
    await assert.rejects(deliverCurrentPolicyEnvelope(context, { current: async () => value, sign: async (input) => {
      called = true
      return signer(input)
    } }))
    assert.equal(called, false)
  }
  await assert.rejects(deliverCurrentPolicyEnvelope({ ...context, issuer: '' }, { current: async () => row, sign: signer }))
})

test('route negotiation precedes legacy version/304 and preserves authenticated middleware', () => {
  for (const file of ['platform/internal/console/tenants/[tenantCode]/bundle.get.ts', 'v1/runtime/deployments/[deploymentCode]/bundle.get.ts']) {
    const source = readFileSync(new URL(`../server/api/${file}`, import.meta.url), 'utf8')
    assert.ok(source.indexOf('query.format === \'hzy-policy-envelope.v1\'') < source.indexOf('if (maybeReturnPolicyBundleNotModified'))
    assert.match(source, /if \(query.version \|\| query.bundleVersion\) throw/)
  }
  const source = readFileSync(new URL('../server/utils/policyBundle.ts', import.meta.url), 'utf8')
  const query = source.slice(source.indexOf('export async function findCurrentPolicyEnvelopeRow'))
  assert.match(query, /MAX\(latest.id\)/)
  assert.doesNotMatch(query.split('export function formatPolicyBundleSignature')[0], /latest.status|pb.status = 'active'/)
})

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof PolicyEnvelopeRefusal ? error.code : 'unavailable'
  }
  return 'accepted'
}

test('renewal refusals carry stable codes; Platform-side faults stay unavailable', async () => {
  const cases: [unknown, string][] = [
    [null, 'policy_envelope_current_missing'],
    [{ ...row, status: 'revoked' }, 'policy_envelope_current_missing'],
    [{ ...row, tenant: 'other' }, 'policy_envelope_current_missing'],
    [{ ...row, policyExpiresAt: context.now }, 'policy_envelope_current_missing'],
    [{ ...row, deploymentStatus: 'disabled' }, 'policy_deployment_inactive'],
    [{ ...row, payloadHash: 'forged' }, 'unavailable'],
    [{ ...row, policyRevision: 13 }, 'unavailable']
  ]
  for (const [value, expected] of cases) {
    const current = async () => value as typeof row
    assert.equal(await refusal(deliverCurrentPolicyEnvelope(context, { current, sign: signer })), expected)
    assert.equal(await refusal(describeCurrentPolicyRevision(context, { current })), expected === 'unavailable' && (value as typeof row).policyRevision === 13 ? 'accepted' : expected)
  }
  await assert.rejects(deliverCurrentPolicyEnvelope({ ...context, issuer: '' }, { current: async () => row, sign: signer }),
    (error: unknown) => !(error instanceof PolicyEnvelopeRefusal))
})

test('suspended and disabled tenants receive signed inactive envelopes of the current revision', async () => {
  for (const [tenantStatus, status] of [['suspended', 'suspended'], ['disabled', 'revoked'], ['archived', 'revoked']] as const) {
    const deps = { current: async () => ({ ...row, tenantStatus }), sign: signer }
    const envelope = await deliverCurrentPolicyEnvelope(context, deps)
    const body = verifyPolicyEnvelope(envelope, key, { ...context, requireActive: false })
    assert.equal(body.status, status)
    assert.equal(body.policyRevision, row.policyRevision)
    assert.equal(body.payload, row.payload)
    assert.throws(() => verifyPolicyEnvelope(envelope, key, context))
    assert.equal((await describeCurrentPolicyRevision(context, deps)).status, status)
  }
})

test('revision probe exposes identity only, without signing or payload', async () => {
  const probe = await describeCurrentPolicyRevision(context, { current: async () => row })
  assert.deepEqual(probe, { tenant: row.tenant, environment: row.environment, deployment: row.deployment, bundleVersion: row.bundleVersion,
    policyRevision: row.policyRevision, payloadHash: row.payloadHash, status: 'active', policyExpiresAt: null })
})

test('500 KB cached payload preserves the original canonical bytes, revision and signed envelope', async () => {
  const large = {
    tenant: { tenantCode: context.tenant }, environment: context.environment, policyRevision: row.policyRevision,
    deployments: [{ deploymentCode: context.deployment, environment: context.environment, status: 'active' }],
    grants: Array.from({ length: 5500 }, (_, index) => ({ resourceCode: `resource_${index}`, action: 'read', roleCode: `role_${index}`, label: '测试界面' }))
  }
  // Original policyBundle.ts serializer, kept here as an independent reference.
  const oldNormalize = (value: unknown): unknown => {
    if (value === null || value === undefined) return null
    if (Array.isArray(value)) return value.map(oldNormalize)
    if (typeof value === 'object') {
      const normalized: Record<string, unknown> = {}
      for (const key of Object.keys(value).sort()) normalized[key] = oldNormalize((value as Record<string, unknown>)[key])
      return normalized
    }
    return ['string', 'number', 'boolean'].includes(typeof value) ? value : String(value)
  }
  const original = JSON.stringify(oldNormalize(large))
  assert.ok(Buffer.byteLength(original) >= 500_000)
  assert.equal(stableStringifyPolicyPayload(large), original)
  const largeRow = { ...row, payload: original, payloadHash: policyPayloadHash(original) }
  const beforeRevision = await describeCurrentPolicyRevision(context, { current: async () => largeRow })
  const beforeEnvelope = await deliverCurrentPolicyEnvelope(context, { current: async () => largeRow, sign: signer })
  let loads = 0
  const input = { bundleId: 901, bundleHash: largeRow.payloadHash, storageHash: 'storage-a', load: async () => {
    loads++
    return { value: JSON.parse(JSON.stringify(large)), storageHash: 'storage-a' }
  } }
  const first = await cachedCurrentPolicyPayload(input)
  const second = await cachedCurrentPolicyPayload(input)
  assert.equal(loads, 1)
  assert.equal(first, original)
  assert.equal(second, original)
  const cachedRow = { ...largeRow, payload: second }
  assert.equal(JSON.stringify(await describeCurrentPolicyRevision(context, { current: async () => cachedRow })), JSON.stringify(beforeRevision))
  assert.equal(JSON.stringify(await deliverCurrentPolicyEnvelope(context, { current: async () => cachedRow, sign: signer })), JSON.stringify(beforeEnvelope))
})

test('storage change invalidates the cache and corrupted bytes stay unavailable', async () => {
  const canonical = stableStringifyPolicyPayload(JSON.parse(row.payload))
  const input = { bundleId: 902, bundleHash: policyPayloadHash(canonical), storageHash: 'storage-a', load: async () => ({ value: JSON.parse(row.payload), storageHash: 'storage-a' }) }
  assert.equal(await cachedCurrentPolicyPayload(input), canonical)
  await assert.rejects(cachedCurrentPolicyPayload({ ...input, storageHash: 'storage-b', load: async () => ({ value: { tampered: true }, storageHash: 'storage-b' }) }),
    /policy_envelope_current_unavailable/)
  await assert.rejects(cachedCurrentPolicyPayload({ ...input, storageHash: 'storage-b', load: async () => ({ value: JSON.parse(row.payload), storageHash: 'storage-c' }) }),
    /policy_envelope_current_unavailable/)
  // A valid row can still be loaded after either failed invalidation.
  assert.equal(await cachedCurrentPolicyPayload({ ...input, storageHash: 'storage-b', load: async () => ({ value: JSON.parse(row.payload), storageHash: 'storage-b' }) }), canonical)
})

test('current-row query probes a storage fingerprint before fetching large JSON and the cache is bounded', async () => {
  const canonicalHash = policyPayloadHash(stableStringifyPolicyPayload(JSON.parse(row.payload)))
  const source = readFileSync(new URL('../server/utils/policyBundle.ts', import.meta.url), 'utf8')
  const current = source.slice(source.indexOf('export async function findCurrentPolicyEnvelopeRow')).split('export function formatPolicyBundleSignature')[0]
  const metadataQuery = current.slice(current.indexOf('`SELECT pb.id'), current.indexOf('FROM policy_bundles pb'))
  assert.doesNotMatch(metadataQuery, /pb\.\*|bundle_payload_json\s*(?:,|FROM)/)
  assert.match(metadataQuery, /SHA2\(CAST\(pb\.bundle_payload_json AS CHAR\), 256\)/)
  assert.match(current, /AND pb\.id=\(SELECT MAX\(latest\.id\)[\s\S]*?\)\s+LIMIT 1`/)
  assert.match(current, /FROM policy_bundles WHERE id = \? LIMIT 1`/)
  const route = readFileSync(new URL('../server/api/platform/internal/console/tenants/[tenantCode]/bundle.get.ts', import.meta.url), 'utf8')
  const signedBranch = route.slice(route.indexOf('if (signedPolicy) {'), route.indexOf('const bundle = await findOrGeneratePolicyBundleForDeployment'))
  assert.match(signedBranch, /currentPolicyRevision\(event, deployment\)/)
  assert.match(signedBranch, /currentPolicyEnvelope\(event, deployment\)/)
  assert.doesNotMatch(signedBranch, /findOrGeneratePolicyBundleForDeployment|parsePolicyBundlePayload/)
  let reloads = 0
  for (let index = 0; index < 9; index++) {
    await cachedCurrentPolicyPayload({ bundleId: 1000 + index, bundleHash: canonicalHash, storageHash: `storage-${index}`, load: async () => ({ value: JSON.parse(row.payload), storageHash: `storage-${index}` }) })
  }
  await cachedCurrentPolicyPayload({ bundleId: 1000, bundleHash: canonicalHash, storageHash: 'storage-0', load: async () => {
    reloads++
    return { value: JSON.parse(row.payload), storageHash: 'storage-0' }
  } })
  assert.equal(reloads, 1)
})

test('prod signs the five-minute default unless the 60-minute lease is configured, never longer', async () => {
  const prodPayload = payload.replaceAll('"test"', '"prod"')
  const prodRow = { ...row, environment: 'prod', payload: prodPayload, payloadHash: policyPayloadHash(prodPayload) }
  const prod = { ...context, environment: 'prod' }
  const deps = { current: async () => prodRow, sign: signer }
  const defaultLease = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(prod, deps), key, { ...prod, maxAgeMs: 3_600_000 })
  assert.equal(defaultLease.expiresAt - defaultLease.issuedAt, 300000)
  const hour = { ...prod, maxAgeMs: 3_600_000 }
  const configured = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(hour, deps), key, hour)
  assert.equal(configured.expiresAt - configured.issuedAt, 3_600_000)
  assert.equal(await refusal(deliverCurrentPolicyEnvelope({ ...prod, maxAgeMs: 3_600_001 }, deps)), 'unavailable')
})

test('routes negotiate the revision probe with the same refusal codes and no legacy 304', () => {
  for (const file of ['platform/internal/console/tenants/[tenantCode]/bundle.get.ts', 'v1/runtime/deployments/[deploymentCode]/bundle.get.ts']) {
    const source = readFileSync(new URL(`../server/api/${file}`, import.meta.url), 'utf8')
    assert.ok(source.indexOf('query.format === \'hzy-policy-revision.v1\'') < source.indexOf('if (maybeReturnPolicyBundleNotModified'))
    assert.match(source, /if \(signedPolicy\) throw policyDeploymentRefusal\('inactive'\)/)
  }
  const query = readFileSync(new URL('../server/utils/policyBundle.ts', import.meta.url), 'utf8')
  const current = query.slice(query.indexOf('export async function findCurrentPolicyEnvelopeRow')).split('export function formatPolicyBundleSignature')[0]
  assert.doesNotMatch(current, /t\.status='active'|d\.status='active'/)
  assert.match(current, /t\.status AS tenant_status, d\.status AS deployment_status/)
})
