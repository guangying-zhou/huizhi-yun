import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { issuePolicyEnvelope } from '../server/utils/policyEnvelope.ts'
import { verifyPolicyEnvelope, policyEnvelopeSigningInput, type PolicyEnvelopeBody } from '../packages/authz-core/src/policy-envelope.ts'

const keys = generateKeyPairSync('ed25519')
const key = { kid: 'fixture-key', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const context = { issuer: 'https://platform.example', tenant: 'tenant-1', environment: 'test', deployment: 'console-test', now: 1000000 }
const input = {
  issuer: context.issuer, tenant: context.tenant, environment: 'test' as const, deployments: ['console-test', 'enterprise-test'],
  bundleVersion: 'pv_test_12', policyRevision: 12, status: 'active' as const,
  issuedAt: context.now, expiresAt: context.now + 300000, policyExpiresAt: null,
  payload: JSON.stringify({ tenant: { tenantCode: 'tenant-1' }, environment: 'test', policyRevision: 12,
    deployments: ['console-test', 'enterprise-test'].map(deploymentCode => ({ deploymentCode, environment: 'test', status: 'active' })),
    label: '企业策略 < & >', grants: [] })
}
const signer = async (body: string) => ({ kid: key.kid, alg: 'Ed25519', signature: sign(null, Buffer.from(body), keys.privateKey).toString('base64url') })

test('Platform producer and Host verifier agree on full envelope, including Unicode payload', async () => {
  const envelope = await issuePolicyEnvelope(input, context, signer)
  const body = verifyPolicyEnvelope(envelope, key, context)
  assert.equal(body.bundleVersion, input.bundleVersion)
  assert.equal(body.payload, input.payload)
  assert.equal(verifyPolicyEnvelope(envelope, key, { ...context, deployment: 'enterprise-test' }).policyRevision, 12)
})

test('every outer policy fact is now authenticated, without Gateway secrets', async () => {
  const envelope = await issuePolicyEnvelope(input, context, signer)
  for (const [name, value] of Object.entries({ bundleVersion: 'invented', status: 'revoked', expiresAt: context.now + 600000,
    issuedAt: context.now - 1, policyExpiresAt: context.now + 200000, tenant: 'other', environment: 'prod',
    deployments: ['other'], policyRevision: 13, issuer: 'https://other.example', purpose: 'token-signing', payload: '{}' })) {
    const body = { ...JSON.parse(envelope.body), [name]: value }
    assert.throws(() => verifyPolicyEnvelope({ ...envelope, body: JSON.stringify(body) }, key, context), /policy_envelope_invalid/, name)
  }
})

test('wrong trust anchor, algorithm, schema and legacy envelope are rejected', async () => {
  const envelope = await issuePolicyEnvelope(input, context, signer)
  for (const patch of [{ kid: 'other' }, { alg: 'HS256' }, { schema: 'v0' }, { signature: 'A'.repeat(86) }, { jku: 'https://attacker.example' }]) {
    assert.throws(() => verifyPolicyEnvelope({ ...envelope, ...patch }, key, context))
  }
  assert.throws(() => verifyPolicyEnvelope({ body: envelope.body, mac: 'old-hmac' }, key, context))
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  assert.throws(() => verifyPolicyEnvelope(envelope, { ...key, publicKey: other }, context))
})

test('binding and freshness are required even with a valid signature', async () => {
  const envelope = await issuePolicyEnvelope(input, context, signer)
  for (const patch of [{ tenant: 'other' }, { environment: 'prod' }, { deployment: 'other' },
    { issuer: 'https://other.example' }, { now: context.now - 1 }, { now: input.expiresAt }, { maxAgeMs: 999 }]) {
    assert.throws(() => verifyPolicyEnvelope(envelope, key, { ...context, ...patch }))
  }
  await assert.rejects(issuePolicyEnvelope({ ...input, expiresAt: context.now + 300001 }, context, signer))
  await assert.rejects(issuePolicyEnvelope({ ...input, policyExpiresAt: context.now + 1000 }, context, signer))
})

test('no implicit production lifetime expansion and inactive policy is never authorized', async () => {
  const envelope = await issuePolicyEnvelope({ ...input, status: 'revoked' }, context, signer)
  assert.equal(verifyPolicyEnvelope(envelope, key, { ...context, requireActive: false }).status, 'revoked')
  assert.throws(() => verifyPolicyEnvelope(envelope, key, context))
  assert.throws(() => verifyPolicyEnvelope(envelope, key, { ...context, environment: 'prod', maxAgeMs: 93600000 }))
})

test('even an authentic envelope must have internally consistent payload facts and bounded fields', async () => {
  const envelope = await issuePolicyEnvelope(input, context, signer)
  const valid = JSON.parse(envelope.body) as PolicyEnvelopeBody
  for (const patch of [{ policyRevision: 99 }, { deployments: ['other'] }, { deployments: ['console-test', 'console-test'] },
    { payloadHash: 'wrong' }, { unknown: true }, { purpose: 'arbitrary-signing' }]) {
    const body = JSON.stringify({ ...valid, ...patch })
    const signed = await signer(policyEnvelopeSigningInput(body))
    assert.throws(() => verifyPolicyEnvelope({ ...envelope, body, signature: signed.signature }, key, context))
  }
  assert.throws(() => verifyPolicyEnvelope({ ...envelope, body: 'x'.repeat(4 * 1024 * 1024 + 1) }, key, context))
  const payload = JSON.stringify({ ...JSON.parse(input.payload), padding: '\\'.repeat(1100000) })
  let signed = false
  await assert.rejects(issuePolicyEnvelope({ ...input, payload }, context, async (body) => {
    signed = true
    return signer(body)
  }))
  assert.equal(signed, false, 'serialized envelope limit is enforced before signing')
})
