import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { stableStringifyPolicyPayload } from './policyEnvelopeDelivery.ts'

export function hashPolicyBundleFactsForRevision(payload: Record<string, unknown>) {
  const facts = { ...payload }
  delete facts.generatedAt
  delete facts.policyRevision
  return hashPolicyBundlePayload(stableStringifyPolicyPayload(facts))
}
export function hashPolicyBundlePayload(json: string) {
  return `sha256_${createHash('sha256').update(json).digest('hex')}`
}
export interface ReusableEnvironmentPolicy {
  policy_revision: number
  policy_hash: string | null
  status: string
  expires_at: string | Date | null
  signature: string | null
  signed_by_kid: string | null
  bundle_hash: string
  bundle_payload_json: unknown
}
export function reuseEnvironmentPolicyPayload(previous: ReusableEnvironmentPolicy | null, input: {
  revision: number
  hash: string
  expiresAt: string | null
  sameTargets: boolean
  now: number
}): Record<string, unknown> | null {
  const expiry = previous?.expires_at ? new Date(previous.expires_at).toISOString().slice(0, 19).replace('T', ' ') : null
  if (!previous || Number(previous.policy_revision) !== input.revision || previous.policy_hash !== input.hash
    || previous.status !== 'active' || (expiry && Date.parse(expiry.replace(' ', 'T') + 'Z') <= input.now)
    || expiry !== input.expiresAt || !input.sameTargets || !previous.signature || !previous.signed_by_kid) return null
  const value = typeof previous.bundle_payload_json === 'string' ? JSON.parse(previous.bundle_payload_json) : previous.bundle_payload_json
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 503, message: 'policy_bundle_reuse_invalid' })
  const payload = value as Record<string, unknown>
  if (hashPolicyBundlePayload(stableStringifyPolicyPayload(payload)) !== previous.bundle_hash
    || hashPolicyBundleFactsForRevision(payload) !== input.hash) throw createError({ statusCode: 503, message: 'policy_bundle_reuse_invalid' })
  return payload
}
