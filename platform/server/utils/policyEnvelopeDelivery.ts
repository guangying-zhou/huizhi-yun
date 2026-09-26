import { issuePolicyEnvelope } from './policyEnvelope.ts'
import { policyPayloadHash, type PolicyEnvelope, type PolicyEnvelopeBody, type PolicyServiceKey } from '../../packages/authz-core/src/policy-envelope.ts'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// Keep the published bundle's canonical JSON bytes identical to the original
// serializer. MySQL JSON may use a different key order when it is read back.
function normalizeJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(item => normalizeJson(item))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, JsonValue> = {}
    for (const key of Object.keys(record).sort()) normalized[key] = normalizeJson(record[key])
    return normalized
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

export function stableStringifyPolicyPayload(value: unknown) {
  return JSON.stringify(normalizeJson(value))
}

const PAYLOAD_CACHE_LIMIT = 8
const payloadCache = new Map<string, { storageHash: string | null, payload: string }>()

// The storage fingerprint detects an in-place JSON change even when the row id
// and published hash remain unchanged. A cache miss always verifies the
// canonical bytes against the published hash before they can be delivered.
export async function cachedCurrentPolicyPayload(input: {
  bundleId: number
  bundleHash: string
  storageHash: string | null
  load: () => Promise<{ value: unknown, storageHash: string | null } | null>
}): Promise<string> {
  const key = `${input.bundleId}:${input.bundleHash}`
  const hit = payloadCache.get(key)
  if (hit && hit.storageHash === input.storageHash) {
    payloadCache.delete(key)
    payloadCache.set(key, hit)
    return hit.payload
  }
  const loaded = await input.load()
  if (!loaded || loaded.storageHash !== input.storageHash) throw Error('policy_envelope_current_unavailable')
  const payload = stableStringifyPolicyPayload(loaded.value)
  if (policyPayloadHash(payload) !== input.bundleHash) throw Error('policy_envelope_current_unavailable')
  payloadCache.delete(key)
  payloadCache.set(key, { storageHash: input.storageHash, payload })
  if (payloadCache.size > PAYLOAD_CACHE_LIMIT) payloadCache.delete(payloadCache.keys().next().value!)
  return payload
}

export interface CurrentPolicyDeliveryRow {
  tenant: string
  environment: string
  deployment: string
  bundleVersion: string
  policyRevision: number
  status: string
  payload: string
  payloadHash: string
  policyExpiresAt: number | null
  tenantStatus: string
  deploymentStatus: string
}

// Stable, authenticated refusals. The Console syncer records these as
// `refused` (no outage grace); unverifiable responses are `invalid`, and only
// transport failures, 408/429 and 5xx are `platform_unavailable`.
export const POLICY_ENVELOPE_REFUSALS = {
  policy_deployment_inactive: 403,
  policy_envelope_current_missing: 409
} as const
export type PolicyEnvelopeRefusalCode = keyof typeof POLICY_ENVELOPE_REFUSALS

export class PolicyEnvelopeRefusal extends Error {
  readonly code: PolicyEnvelopeRefusalCode
  constructor(code: PolicyEnvelopeRefusalCode) {
    super(code)
    this.code = code
  }
}

// Tenant lifecycle is signed into the envelope so consumers stop immediately;
// a suspended or disabled tenant is never refused into an outage-like failure.
const TENANT_ENVELOPE_STATUS: Record<string, PolicyEnvelopeBody['status']> = {
  active: 'active', suspended: 'suspended', disabled: 'revoked'
}

export interface CurrentPolicyRevision {
  tenant: string
  environment: string
  deployment: string
  bundleVersion: string
  policyRevision: number
  payloadHash: string
  status: PolicyEnvelopeBody['status']
  policyExpiresAt: number | null
}

type DeliveryInput = { tenant: string, environment: string, deployment: string, now: number }

async function currentDelivery(input: DeliveryInput, current: () => Promise<CurrentPolicyDeliveryRow | null>) {
  const row = await current()
  if (!row || row.tenant !== input.tenant || row.environment !== input.environment || row.deployment !== input.deployment
    || row.status !== 'active' || (row.policyExpiresAt !== null && row.policyExpiresAt <= input.now)) {
    throw new PolicyEnvelopeRefusal('policy_envelope_current_missing')
  }
  if (row.deploymentStatus !== 'active') throw new PolicyEnvelopeRefusal('policy_deployment_inactive')
  // Integrity faults are Platform-side failures, not a refusal to renew.
  if (row.payloadHash !== policyPayloadHash(row.payload)) throw Error('policy_envelope_current_unavailable')
  return { row, status: TENANT_ENVELOPE_STATUS[row.tenantStatus] ?? 'revoked' }
}

// Lightweight change probe: current revision identity only, never signed or
// carrying the payload. Same selection and refusal rules as the envelope.
export async function describeCurrentPolicyRevision(input: DeliveryInput, dependencies: {
  current: () => Promise<CurrentPolicyDeliveryRow | null>
}): Promise<CurrentPolicyRevision> {
  const { row, status } = await currentDelivery(input, dependencies.current)
  return {
    tenant: row.tenant, environment: row.environment, deployment: row.deployment, bundleVersion: row.bundleVersion,
    policyRevision: row.policyRevision, payloadHash: row.payloadHash, status, policyExpiresAt: row.policyExpiresAt
  }
}

// Only current authoritative rows are accepted. No historical version input,
// body/URL-supplied issuer, generated fallback or legacy conditional 304 renewal.
export async function deliverCurrentPolicyEnvelope(input: DeliveryInput & {
  issuer: string
  maxAgeMs?: number
}, dependencies: {
  current: () => Promise<CurrentPolicyDeliveryRow | null>
  sign: Parameters<typeof issuePolicyEnvelope>[2]
  serviceKeys?: () => Promise<PolicyServiceKey[]>
}): Promise<PolicyEnvelope> {
  const { row, status } = await currentDelivery(input, dependencies.current)
  const payload = JSON.parse(row.payload) as { deployments?: { deploymentCode: string, environment: string, status: string }[] }
  const deployments = payload.deployments?.filter(d => d.environment === input.environment && d.status === 'active').map(d => d.deploymentCode) || []
  // Only the requesting deployment's own keys, and only while unexpired. The
  // field is omitted when empty so bodies without keys stay byte-identical.
  const serviceKeys = ((await dependencies.serviceKeys?.()) || [])
    .filter(key => key.deployment === input.deployment && deployments.includes(key.deployment) && key.notAfter > input.now)
  return issuePolicyEnvelope({
    issuer: input.issuer, tenant: row.tenant, environment: row.environment as 'prod' | 'test' | 'dev', deployments,
    bundleVersion: row.bundleVersion, policyRevision: row.policyRevision, status,
    issuedAt: input.now, expiresAt: Math.min(input.now + (input.maxAgeMs ?? 300000), row.policyExpiresAt ?? Infinity),
    policyExpiresAt: row.policyExpiresAt, payload: row.payload,
    ...(serviceKeys.length ? { serviceKeys } : {})
  }, input, dependencies.sign)
}
