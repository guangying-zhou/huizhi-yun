import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync, sign } from 'node:crypto'
import { POLICY_ENVELOPE_SCHEMA, policyEnvelopeSigningInput, policyServiceKeyId, verifyPolicyEnvelope } from './policy-envelope.ts'

// Shared with data-runtime/internal/policyenvelope TestServiceKeyVectors.
const testdata = new URL('../../../../data-runtime/internal/policyenvelope/testdata/', import.meta.url)
const fixture = JSON.parse(readFileSync(new URL('platform-envelope.json', testdata), 'utf8'))
const vectors = JSON.parse(readFileSync(new URL('service-key-vectors.json', testdata), 'utf8'))
const keys = generateKeyPairSync('ed25519')
const key = { kid: fixture.envelope.kid, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const context = { issuer: 'https://platform.example', tenant: 'tenant-1', environment: 'test', deployment: 'console-test', now: 1_000_000, maxAgeMs: 300_000 }

function resigned(serviceKeys: unknown) {
  const body = { ...JSON.parse(fixture.envelope.body), serviceKeys }
  const serialized = JSON.stringify(body)
  return { schema: POLICY_ENVELOPE_SCHEMA, alg: 'Ed25519', kid: key.kid, body: serialized,
    signature: sign(null, Buffer.from(policyEnvelopeSigningInput(serialized)), keys.privateKey).toString('base64url') }
}

test('serviceKeys vectors match the Go verifier', () => {
  assert.ok(vectors.cases.length > 0)
  for (const vector of vectors.cases) {
    const verify = () => verifyPolicyEnvelope(resigned(vector.serviceKeys), key, context)
    if (vector.valid) assert.deepEqual(verify().serviceKeys, vector.serviceKeys, vector.name)
    else assert.throws(verify, /policy_envelope_invalid/, vector.name)
  }
  assert.throws(() => verifyPolicyEnvelope(resigned(null), key, context), /policy_envelope_invalid/)
})

test('a body without serviceKeys is unchanged and still valid', () => {
  const body = verifyPolicyEnvelope(fixture.envelope, { kid: fixture.envelope.kid, publicKey: fixture.publicKey }, context)
  assert.equal(Object.hasOwn(body, 'serviceKeys'), false)
})

test('key id is derived from the raw public key', () => {
  const raw = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url')
  assert.equal(policyServiceKeyId(raw), vectors.cases[0].serviceKeys[0].kid)
})
