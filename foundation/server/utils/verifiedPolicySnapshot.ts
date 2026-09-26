import { createHash } from 'node:crypto'
import {
  evaluatePolicyEnvelopeValidity, policyEnvelopeMaxAge, verifyPolicyEnvelope, verifyPolicyEnvelopeAuthenticity,
  type PolicyEnvelope, type PolicyEnvelopeContext, type PolicyRenewal
} from '@hzy/authz-core/policy-envelope'

// Caller MUST obtain this snapshot via the authenticated, tenant-bound Runtime
// transport. These metadata fields are not a standalone proof and must never be
// accepted from browser input, an arbitrary URL, or the legacy opaque GET.
// `renewal` is Runtime-timed syncer state; it only decides outage grace.
export function verifyRuntimePolicySnapshot(
  snapshot: { tenant: string, environment: string, deployment: string, envelope: PolicyEnvelope, etag: string, acceptedAt: number, policyRevision: number, issuedAt: number, payloadHash: string, renewal?: PolicyRenewal | null },
  key: { kid: string, publicKey: string },
  context: PolicyEnvelopeContext
) {
  const body = verifyPolicyEnvelopeAuthenticity(snapshot.envelope, key, context)
  const etag = createHash('sha256').update(`${snapshot.envelope.kid}\n${snapshot.envelope.body}\n${snapshot.envelope.signature}`).digest('hex')
  if (snapshot.tenant !== context.tenant || snapshot.environment !== context.environment || snapshot.deployment !== context.deployment
    || snapshot.etag !== etag || snapshot.policyRevision !== body.policyRevision || snapshot.issuedAt !== body.issuedAt
    || snapshot.payloadHash !== body.payloadHash || !Number.isSafeInteger(snapshot.acceptedAt)
    || snapshot.acceptedAt < body.issuedAt || snapshot.acceptedAt > context.now) throw Error('policy_snapshot_invalid')
  const validity = evaluatePolicyEnvelopeValidity(body, snapshot.renewal ?? null, context.now)
  if (validity.verdict === 'inactive') throw Error('policy_snapshot_inactive')
  if (validity.verdict === 'expired' || validity.validUntil === null) throw Error('policy_snapshot_expired')
  // Neither a refreshed memory cache nor a repeated read extends this deadline.
  const validUntil = validity.verdict === 'valid'
    ? Math.min(validity.validUntil, snapshot.acceptedAt + policyEnvelopeMaxAge(context))
    : validity.validUntil
  if (context.now >= validUntil) throw Error('policy_snapshot_expired')
  return {
    body,
    payload: JSON.parse(body.payload) as Record<string, unknown>,
    validUntil,
    validity: validity.verdict as 'valid' | 'grace'
  }
}

// Synchronization only: expired/inactive durable state is a CAS watermark, not
// permission to serve requests. Never use this result as an authorization view.
export function verifyRuntimePolicyWatermark(
  snapshot: Parameters<typeof verifyRuntimePolicySnapshot>[0],
  key: Parameters<typeof verifyRuntimePolicySnapshot>[1],
  context: PolicyEnvelopeContext
) {
  const body = verifyPolicyEnvelope(snapshot.envelope, key, { ...context, now: snapshot.acceptedAt, requireActive: false })
  const etag = createHash('sha256').update(`${snapshot.envelope.kid}\n${snapshot.envelope.body}\n${snapshot.envelope.signature}`).digest('hex')
  if (snapshot.tenant !== context.tenant || snapshot.environment !== context.environment || snapshot.deployment !== context.deployment
    || snapshot.etag !== etag || snapshot.policyRevision !== body.policyRevision || snapshot.issuedAt !== body.issuedAt
    || snapshot.payloadHash !== body.payloadHash || !Number.isSafeInteger(snapshot.acceptedAt)
    || snapshot.acceptedAt < body.issuedAt || snapshot.acceptedAt > context.now) throw Error('policy_snapshot_invalid')
  return snapshot.etag
}
