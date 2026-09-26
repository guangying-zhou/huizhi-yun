import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { issuePolicyEnvelope } from '../../platform/server/utils/policyEnvelope.ts'
import { synchronizeVerifiedPolicy, verifiedSnapshotBundle } from '../server/utils/verifiedPolicySync.ts'
import * as sync from '../server/utils/verifiedPolicySync.ts'
import { policyBundleRequestQuery } from '../server/utils/platformRuntimePolicyContextCore.ts'
import type { PolicyEnvelope } from '@hzy/authz-core/policy-envelope'
import type { VerifiedPolicySnapshot } from '@hzy/foundation/server/utils/consoleVerifiedPolicyStore'

const context = { issuer: 'https://platform.example', tenant: 'tenant', environment: 'test', deployment: 'console-test' }
const keys = generateKeyPairSync('ed25519')
const key = { kid: 'fixture', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
async function fixture(issuedAt = 1000000, revision = 1) {
  const payload = JSON.stringify({ tenant: { tenantCode: context.tenant }, environment: 'test', policyRevision: revision,
    deployments: [{ deploymentCode: context.deployment, environment: 'test', status: 'active' }] })
  const envelope = await issuePolicyEnvelope({ issuer: context.issuer, tenant: context.tenant, environment: 'test', deployments: [context.deployment],
    bundleVersion: `v${revision}`, policyRevision: revision, status: 'active', issuedAt, expiresAt: issuedAt + 300000,
    policyExpiresAt: null, payload }, { ...context, now: issuedAt }, async input => ({ kid: key.kid, alg: 'Ed25519',
    signature: sign(null, Buffer.from(input), keys.privateKey).toString('base64url') }))
  const body = JSON.parse(envelope.body)
  const snapshot: VerifiedPolicySnapshot = { ...context, envelope, etag: createHash('sha256').update(`${key.kid}\n${envelope.body}\n${envelope.signature}`).digest('hex'),
    acceptedAt: issuedAt + 1, issuedAt, policyRevision: revision, payloadHash: body.payloadHash }
  return { envelope, snapshot }
}

test('first write and lost response retry retain the exact envelope and acceptance time', async () => {
  const { envelope, snapshot } = await fixture()
  let current: VerifiedPolicySnapshot | null = null
  let writes = 0
  let clock = 1000010
  const store = {
    async get() { return current },
    async put(input: PolicyEnvelope, etag: string) {
      assert.equal(input, envelope)
      assert.equal(etag, current?.etag || '')
      current = snapshot
      if (++writes === 1) throw Error('response lost after commit')
      return current
    }
  }
  await assert.rejects(synchronizeVerifiedPolicy(store, envelope, key, context, () => clock), /response lost/)
  clock += 100
  const result = await synchronizeVerifiedPolicy(store, envelope, key, context, () => clock)
  assert.equal(result.cachedAt, new Date(snapshot.acceptedAt).toISOString())
  assert.equal(result.expiresAt, new Date(1300000).toISOString())
})

test('expired authentic watermark is retained for recovery, but cannot authorize reads', async () => {
  const old = await fixture()
  const fresh = await fixture(1400000)
  assert.throws(() => verifiedSnapshotBundle(old.snapshot, key, { ...context, now: 1400010 }))
  const result = await synchronizeVerifiedPolicy({
    async get() { return old.snapshot },
    async put(input, etag) {
      assert.equal(etag, old.snapshot.etag)
      assert.equal(input, fresh.envelope)
      return fresh.snapshot
    } }, fresh.envelope, key, context, () => 1400010)
  assert.equal(result.cachedAt, new Date(fresh.snapshot.acceptedAt).toISOString())
})

test('CAS conflict returns the verified winner without a forced second write', async () => {
  const first = await fixture()
  const newer = await fixture(1000020, 2)
  let reads = 0
  let writes = 0
  const result = await synchronizeVerifiedPolicy({
    async get() { return ++reads === 1 ? first.snapshot : newer.snapshot },
    async put() {
      writes++
      throw { statusCode: 409, data: { code: 'policy_snapshot_conflict' } }
    } }, first.envelope, key, context, () => 1000030)
  assert.equal(result.bundleVersion, 'v2')
  assert.equal(writes, 1)
})

test('unavailable, revoked access and invalid watermarks never become first creation', async () => {
  const { envelope, snapshot } = await fixture()
  for (const code of [403, 404, 503]) {
    await assert.rejects(synchronizeVerifiedPolicy({
      async get() { throw { statusCode: code } },
      async put() { assert.fail('must not write') }
    }, envelope, key, context, () => 1000010))
  }
  for (const patch of [{ tenant: 'other' }, { etag: 'bad' }, { acceptedAt: 999999 }, { acceptedAt: 2000000 }]) {
    await assert.rejects(synchronizeVerifiedPolicy({
      async get() { return { ...snapshot, ...patch } },
      async put() { assert.fail('must not write') }
    }, envelope, key, context, () => 1000010))
  }
})

test('legacy or tampered Platform format is rejected before contacting persistence', async () => {
  const { envelope } = await fixture()
  for (const input of [{ body: '{}', mac: 'old' }, { ...envelope, body: '{}' }]) {
    await assert.rejects(synchronizeVerifiedPolicy({
      async get() { assert.fail('must not read') },
      async put() { assert.fail('must not write') }
    }, input as PolicyEnvelope, key, context, () => 1000010))
  }
})

test('actual Platform fetch function requests full envelopes in both activation modes', async () => {
  const { envelope } = await fixture(Date.now() - 20)
  const source = readFileSync(new URL('../server/utils/platformRuntime.ts', import.meta.url), 'utf8')
  const functionSource = source.slice(source.indexOf('export async function fetchAndVerifyPolicyBundle('), source.indexOf('export async function postPlatformHeartbeat('))
  const js = ts.transpileModule(functionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const config = { tenantCode: context.tenant, deploymentCode: context.deployment, environment: context.environment,
    baseUrl: context.issuer, platformServiceToken: 'fixture-only', runtimeToken: 'fixture-only' }
  let response: unknown = envelope
  const calls: { url: string, options: { query: Record<string, string> } }[] = []
  const exports: { fetchAndVerifyPolicyBundle?: (config: unknown) => Promise<{ bundleVersion: string }> } = {}
  new Function('exports', 'require', 'verifiedPolicyStoreEnabled', 'policyBundleFetchTimeoutMs', 'platformRuntimeFetch',
    'policyBundleRequestQuery', 'isSuccessfulPlatformBundleEnvelope', js)(exports, (name: string) => {
    if (name === './verifiedPolicyRuntime') return { verifiedPolicyTrust: () => ({ key, context }) }
    if (name === './verifiedPolicySync') return sync
    throw Error(`unexpected import ${name}`)
  }, () => true, () => 5000, async (url: string, options: { query: Record<string, string> }) => {
    calls.push({ url, options })
    return { code: 0, data: response }
  }, policyBundleRequestQuery, (value: { code: number }) => value.code === 0)
  for (const activationMode of ['managed-cloud-multitenant', 'standalone']) {
    assert.equal((await exports.fetchAndVerifyPolicyBundle!({ ...config, activationMode })).bundleVersion, 'v1')
  }
  assert.ok(calls[0]!.url.includes('/internal/console/tenants/tenant/bundle'))
  assert.ok(calls[1]!.url.includes('/runtime/deployments/console-test/bundle'))
  assert.ok(calls.every(call => call.options.query.format === 'hzy-policy-envelope.v1'))
  assert.equal(calls[0]!.options.query.deploymentCode, context.deployment)
  response = { bundleVersion: 'legacy', bundle: {} }
  await assert.rejects(exports.fetchAndVerifyPolicyBundle!({ ...config, activationMode: 'managed-cloud-multitenant' }))
})
