import { verifyPolicyEnvelope, type PolicyEnvelope, type PolicyEnvelopeBody, type PolicyEnvelopeContext } from '@hzy/authz-core/policy-envelope'
import { verifyRuntimePolicySnapshot, verifyRuntimePolicyWatermark } from '@hzy/foundation/server/utils/verifiedPolicySnapshot'
import type { VerifiedPolicySnapshot } from '@hzy/foundation/server/utils/consoleVerifiedPolicyStore'
import type { CachedPolicyBundle } from './bundleCache'
import { evaluateEnterpriseEntitlement } from './enterpriseEntitlement'

type Key = { kid: string, publicKey: string }
type Context = Omit<PolicyEnvelopeContext, 'now'>
type Store = { get(): Promise<VerifiedPolicySnapshot | null>, put(envelope: PolicyEnvelope, expectedEtag: string): Promise<VerifiedPolicySnapshot> }

function bundleFromVerifiedBody(envelope: PolicyEnvelope, body: PolicyEnvelopeBody, payload: Record<string, unknown>, context: PolicyEnvelopeContext): CachedPolicyBundle {
  if (evaluateEnterpriseEntitlement(payload, context.tenant, context.now).reason === 'enterprise_entitlement_invalid') throw Error('enterprise_entitlement_invalid')
  return {
    tenantCode: body.tenant, deploymentCode: context.deployment, bundleVersion: body.bundleVersion,
    bundleHash: body.payloadHash, schemaVersion: String(payload.schemaVersion || ''), status: body.status,
    generatedAt: new Date(body.issuedAt).toISOString(), expiresAt: new Date(body.expiresAt).toISOString(),
    signature: envelope.signature, kid: envelope.kid, alg: envelope.alg, signedAt: new Date(body.issuedAt).toISOString(),
    payload, cachedAt: new Date(body.issuedAt).toISOString(), verifiedEnvelope: envelope
  }
}

// Freshly delivered envelopes. Synchronization passes allowInactive so a signed
// suspension/revocation is persisted; authorization reads still reject it.
export function verifiedEnvelopeBundle(envelope: PolicyEnvelope, key: Key, context: PolicyEnvelopeContext, options: { allowInactive?: boolean } = {}): CachedPolicyBundle {
  const body = verifyPolicyEnvelope(envelope, key, { ...context, requireActive: options.allowInactive !== true })
  return bundleFromVerifiedBody(envelope, body, JSON.parse(body.payload) as Record<string, unknown>, context)
}

// Authorization view of the Runtime receipt: one verification pass, with the
// outage-grace verdict from the Runtime renewal state.
export function verifiedSnapshotBundle(snapshot: VerifiedPolicySnapshot, key: Key, context: PolicyEnvelopeContext): CachedPolicyBundle {
  const verified = verifyRuntimePolicySnapshot(snapshot, key, context)
  return { ...bundleFromVerifiedBody(snapshot.envelope, verified.body, verified.payload, context), cachedAt: new Date(snapshot.acceptedAt).toISOString(),
    expiresAt: new Date(verified.validUntil).toISOString(), policyValidity: verified.validity }
}

export async function synchronizeVerifiedPolicy(store: Store, envelope: PolicyEnvelope, key: Key, context: Context, now = Date.now) {
  verifiedEnvelopeBundle(envelope, key, { ...context, now: now() }, { allowInactive: true })
  const current = await store.get()
  const expected = current ? verifyRuntimePolicyWatermark(current, key, { ...context, now: now() }) : ''
  let receipt: VerifiedPolicySnapshot
  try {
    receipt = await store.put(envelope, expected)
  } catch (error) {
    const failure = error as { statusCode?: number, data?: { code?: string } }
    if (failure.statusCode !== 409 || failure.data?.code !== 'policy_snapshot_conflict') throw error
    const winner = await store.get()
    if (!winner) throw Error('policy_snapshot_unavailable')
    receipt = winner
  }
  // A lost-response retry must reuse the same envelope. Runtime returns its
  // original receipt. No retry here fetches or re-signs a fresher envelope.
  return verifiedSnapshotBundle(receipt, key, { ...context, now: now() })
}
