import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPolicyBundleFactsForRevision, hashPolicyBundlePayload, reuseEnvironmentPolicyPayload } from '../server/utils/environmentPolicyPayload.ts'
import { stableStringifyPolicyPayload } from '../server/utils/policyEnvelopeDelivery.ts'
import { resolveTenantEnvironmentPolicyRevision } from '../server/utils/environmentPolicyRevision.ts'
import { requireRuntimeReleaseEnvironment, runtimeReleaseChannel, requireRuntimeReleaseUpdateMode } from '../server/utils/runtimeReleaseEnvironment.ts'

test('environment release mapping is explicit; unknown / retired fail closed', () => {
  for (const env of ['prod', 'test', 'dev']) assert.equal(runtimeReleaseChannel(env), `stable-${env}`)
  for (const value of [undefined, '', 'all', 'PROD']) assert.throws(() => requireRuntimeReleaseEnvironment(value), { statusCode: 400 })
  assert.throws(() => requireRuntimeReleaseUpdateMode('retired'), { statusCode: 403 })
  assert.throws(() => requireRuntimeReleaseUpdateMode(undefined), { statusCode: 503 })
})

test('reuse signed payload preserves generatedAt; expiry/targets/status/hash changes cannot reuse', () => {
  const payload = { generatedAt: 'original', environment: 'prod', policyRevision: 38, rolePermissionGrants: [{ action: 'view' }] }
  const hash = hashPolicyBundleFactsForRevision(payload)
  const previous = { policy_revision: 38, policy_hash: hash, status: 'active', expires_at: null, signature: 'fixture', signed_by_kid: 'k', bundle_hash: hashPolicyBundlePayload(stableStringifyPolicyPayload(payload)), bundle_payload_json: payload }
  const input = { revision: 38, hash, expiresAt: null, sameTargets: true, now: 1000 }
  assert.deepEqual(reuseEnvironmentPolicyPayload(previous, input), payload)
  assert.equal(hashPolicyBundleFactsForRevision({ ...payload, generatedAt: 'new' }), hash)
  for (const value of [{ ...input, revision: 39 }, { ...input, sameTargets: false }, { ...input, expiresAt: '2099-01-01 00:00:00' }]) assert.equal(reuseEnvironmentPolicyPayload(previous, value), null)
  assert.equal(reuseEnvironmentPolicyPayload({ ...previous, status: 'revoked' }, input), null)
  assert.throws(() => reuseEnvironmentPolicyPayload({ ...previous, bundle_payload_json: { ...payload, rolePermissionGrants: [] } }, input), { statusCode: 503 })
})

test('production and test maintain separate monotonic rows; explicit fresh payload advance', async () => {
  const states = new Map([['prod', { policyRevision: 38, policyHash: 'prod' }], ['test', { policyRevision: 38, policyHash: null as string | null }]])
  const tx = {
    async queryRow(_sql: string, args: unknown[]) { return states.get(String(args[1])) },
    async execute(sql: string, args: unknown[]) {
      if (sql.startsWith('UPDATE')) states.set(String(args[3]), { policyRevision: Number(args[0]), policyHash: String(args[1]) })
      return { affectedRows: 1 }
    }
  } as unknown as Parameters<typeof resolveTenantEnvironmentPolicyRevision>[0]
  assert.equal(await resolveTenantEnvironmentPolicyRevision(tx, 'T', 'prod', 'prod'), 38)
  assert.equal(await resolveTenantEnvironmentPolicyRevision(tx, 'T', 'test', 'test'), 39)
  assert.equal(states.get('prod')?.policyRevision, 38)
  assert.equal(await resolveTenantEnvironmentPolicyRevision(tx, 'T', 'changed-prod', 'prod'), 39)
  assert.equal(states.get('test')?.policyRevision, 39)
  assert.equal(await resolveTenantEnvironmentPolicyRevision(tx, 'T', 'changed-prod', 'prod', true), 40)
})

test('invalid revision row fails closed rather than restarting a watermark', async () => {
  for (const current of [null, { policyRevision: -1 }, { policyRevision: 'broken' }]) {
    const tx = { execute: async () => ({ affectedRows: 1 }), queryRow: async () => current } as unknown as Parameters<typeof resolveTenantEnvironmentPolicyRevision>[0]
    await assert.rejects(resolveTenantEnvironmentPolicyRevision(tx, 'T', 'hash', 'prod'), { statusCode: 503 })
  }
})

test('expired saved policy cannot reuse its old revision payload', () => {
  const payload = { environment: 'prod', generatedAt: 'original', policyRevision: 38 }
  const hash = hashPolicyBundleFactsForRevision(payload)
  const previous = { policy_revision: 38, policy_hash: hash, status: 'active', expires_at: '2020-01-01 00:00:00', signature: 'fixture', signed_by_kid: 'k', bundle_hash: hashPolicyBundlePayload(stableStringifyPolicyPayload(payload)), bundle_payload_json: payload }
  assert.equal(reuseEnvironmentPolicyPayload(previous, { revision: 38, hash, expiresAt: '2020-01-01 00:00:00', sameTargets: true, now: Date.now() }), null)
})
