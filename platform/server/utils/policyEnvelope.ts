import {
  POLICY_ENVELOPE_SCHEMA, POLICY_ENVELOPE_MAX_BYTES, policyEnvelopeSigningInput, policyPayloadHash, validatePolicyEnvelopeBody,
  type PolicyEnvelope, type PolicyEnvelopeBody, type PolicyEnvelopeContext
} from '@hzy/authz-core/policy-envelope'

type Signer = (input: string) => Promise<{ kid: string, alg: string, signature: string }>

// Signer is the existing Platform signing authority; never an inbound key or URL.
// Kept explicit so isolated tests cannot accidentally initialize real signing keys.
export async function issuePolicyEnvelope(
  input: Omit<PolicyEnvelopeBody, 'purpose' | 'payloadHash'>,
  context: PolicyEnvelopeContext,
  sign: Signer
): Promise<PolicyEnvelope> {
  const body = { ...input, purpose: 'enterprise-policy' as const, payloadHash: policyPayloadHash(input.payload) }
  validatePolicyEnvelopeBody(body, { ...context, requireActive: false })
  const serialized = JSON.stringify(body)
  if (Buffer.byteLength(serialized, 'utf8') > POLICY_ENVELOPE_MAX_BYTES) throw Error('policy_envelope_invalid')
  const signed = await sign(policyEnvelopeSigningInput(serialized))
  if (signed.alg !== 'Ed25519' || !/^[A-Za-z0-9_.:-]{1,191}$/.test(signed.kid)
    || !/^[A-Za-z0-9_-]{86}$/.test(signed.signature)) throw Error('policy_envelope_signing_failed')
  return { schema: POLICY_ENVELOPE_SCHEMA, alg: 'Ed25519', kid: signed.kid, body: serialized, signature: signed.signature }
}
