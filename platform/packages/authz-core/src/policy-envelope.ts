// Server-only, explicitly imported subpath. Never exported by the browser barrel.
import { createHash, createPublicKey, verify } from 'node:crypto'

export const POLICY_ENVELOPE_SCHEMA = 'hzy-policy-envelope.v1'
export const POLICY_ENVELOPE_MAX_BYTES = 4 * 1024 * 1024
export const POLICY_ENVELOPE_MAX_AGE_MS = 300_000
export const POLICY_ENVELOPE_TEST_MAX_AGE_MS = 93_600_000
// Outage renewal policy (docs/Policy-Sync-Cadence-Assessment-20260922.md).
export const POLICY_ENVELOPE_LONG_MAX_AGE_MS = 3_600_000
export const POLICY_ENVELOPE_OUTAGE_GRACE_MS = 86_400_000
export const POLICY_ENVELOPE_RENEWAL_LIVENESS_MS = 1_800_000
// Console deployment keys signed into the envelope (R1 steady service identity).
export const POLICY_SERVICE_KEY_MAX = 4
export const POLICY_SERVICE_KEY_ID = /^csk_[a-f0-9]{16}$/
export interface PolicyEnvelope {
  schema: typeof POLICY_ENVELOPE_SCHEMA
  alg: 'Ed25519'
  kid: string
  body: string
  signature: string
}
export interface PolicyEnvelopeBody {
  purpose: 'enterprise-policy'
  issuer: string
  tenant: string
  environment: 'prod' | 'test' | 'dev'
  deployments: string[]
  bundleVersion: string
  policyRevision: number
  status: 'active' | 'suspended' | 'revoked'
  issuedAt: number
  expiresAt: number
  policyExpiresAt: number | null
  payloadHash: string
  // Exact signed UTF-8 JSON bytes: Go must not reserialize JS numbers/Unicode.
  payload: string
  // Optional; omitted when no key is registered so older bodies stay identical.
  serviceKeys?: PolicyServiceKey[]
}
// A Console deployment's Ed25519 public key (raw 32 bytes, base64url). Runtime
// accepts assertions signed by it only while this envelope is valid or in grace.
export interface PolicyServiceKey {
  deployment: string
  kid: string
  publicKey: string
  notAfter: number
}
export interface PolicyEnvelopeContext {
  issuer: string
  tenant: string
  environment: string
  deployment: string
  now: number
  maxAgeMs?: number
  requireActive?: boolean
}
export function policyEnvelopeSigningInput(body: string) {
  return `${POLICY_ENVELOPE_SCHEMA}\n${body}`
}
export function policyPayloadHash(payload: string) {
  return `sha256_${createHash('sha256').update(payload, 'utf8').digest('hex')}`
}
function reject(): never {
  throw new Error('policy_envelope_invalid')
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject()
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) reject()
}
function text(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,191}$/.test(value)
}
export function policyEnvelopeMaxAge(context: Pick<PolicyEnvelopeContext, 'environment' | 'maxAgeMs'>) {
  const age = context.maxAgeMs ?? POLICY_ENVELOPE_MAX_AGE_MS
  // Consumers accept the 60-minute lease; Platform keeps signing the
  // five-minute default until its lease configuration is switched.
  const limit = context.environment === 'test' ? POLICY_ENVELOPE_TEST_MAX_AGE_MS : POLICY_ENVELOPE_LONG_MAX_AGE_MS
  if (!Number.isSafeInteger(age) || age < 1000 || age > limit) reject()
  return age
}
export function validatePolicyEnvelopeBody(value: unknown, context: PolicyEnvelopeContext): PolicyEnvelopeBody {
  const body = record(value)
  exact(body, ['purpose', 'issuer', 'tenant', 'environment', 'deployments', 'bundleVersion', 'policyRevision',
    'status', 'issuedAt', 'expiresAt', 'policyExpiresAt', 'payloadHash', 'payload',
    ...(Object.hasOwn(body, 'serviceKeys') ? ['serviceKeys'] : [])])
  if (!text(context.tenant) || !text(context.deployment) || !Number.isSafeInteger(context.now) || context.now < 0) reject()
  const origin = new URL(context.issuer)
  if (origin.protocol !== 'https:' || origin.origin !== context.issuer) reject()
  if (body.purpose !== 'enterprise-policy' || body.issuer !== context.issuer || body.tenant !== context.tenant
    || body.environment !== context.environment || !['prod', 'test', 'dev'].includes(context.environment)
    || !text(body.bundleVersion) || !Number.isSafeInteger(body.policyRevision) || Number(body.policyRevision) < 1
    || typeof body.status !== 'string' || !['active', 'suspended', 'revoked'].includes(body.status)) reject()
  if (!Array.isArray(body.deployments) || body.deployments.length < 1 || body.deployments.length > 256
    || body.deployments.some(item => !text(item)) || new Set(body.deployments).size !== body.deployments.length
    || !body.deployments.includes(context.deployment)) reject()
  const age = policyEnvelopeMaxAge(context)
  if (!Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt)
    || Number(body.issuedAt) < 0 || Number(body.issuedAt) > context.now
    || Number(body.expiresAt) <= context.now || Number(body.expiresAt) <= Number(body.issuedAt)
    || Number(body.expiresAt) - Number(body.issuedAt) > age) reject()
  if (body.policyExpiresAt !== null && (!Number.isSafeInteger(body.policyExpiresAt)
    || Number(body.policyExpiresAt) <= context.now || Number(body.expiresAt) > Number(body.policyExpiresAt))) reject()
  if (context.requireActive !== false && body.status !== 'active') reject()
  if (Object.hasOwn(body, 'serviceKeys')) validateServiceKeys(body.serviceKeys, body.deployments as string[], Number(body.issuedAt))
  if (typeof body.payload !== 'string' || Buffer.byteLength(body.payload) > POLICY_ENVELOPE_MAX_BYTES
    || body.payloadHash !== policyPayloadHash(body.payload)) reject()
  const payload = record(JSON.parse(body.payload))
  if (record(payload.tenant).tenantCode !== body.tenant || payload.environment !== body.environment
    || payload.policyRevision !== body.policyRevision || !Array.isArray(payload.deployments)) reject()
  for (const deployment of body.deployments) {
    if (!payload.deployments.some((candidate) => {
      const item = record(candidate)
      return item.deploymentCode === deployment && item.environment === body.environment && item.status === 'active'
    })) reject()
  }
  return body as unknown as PolicyEnvelopeBody
}

function validateServiceKeys(value: unknown, deployments: string[], issuedAt: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > POLICY_SERVICE_KEY_MAX) reject()
  const kids = new Set<string>()
  for (const candidate of value) {
    const key = record(candidate)
    exact(key, ['deployment', 'kid', 'publicKey', 'notAfter'])
    if (!text(key.deployment) || !deployments.includes(key.deployment as string)
      || typeof key.kid !== 'string' || !POLICY_SERVICE_KEY_ID.test(key.kid) || kids.has(key.kid)
      || typeof key.publicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.publicKey)
      || Buffer.from(key.publicKey, 'base64url').length !== 32
      || Buffer.from(key.publicKey, 'base64url').toString('base64url') !== key.publicKey
      || key.kid !== policyServiceKeyId(key.publicKey)
      || !Number.isSafeInteger(key.notAfter) || Number(key.notAfter) <= issuedAt) reject()
    kids.add(key.kid)
  }
}

/** Key id is derived from the key itself, so it cannot be claimed for another key. */
export function policyServiceKeyId(publicKey: string) {
  return `csk_${createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex').slice(0, 16)}`
}

/**
 * Signature, binding and payload checks as of the envelope's own issuance.
 * Today's lifecycle (expiry, grace, status) is NOT decided here; callers must
 * apply evaluatePolicyEnvelopeValidity with the Runtime renewal state.
 */
export function verifyPolicyEnvelopeAuthenticity(value: unknown, key: { kid: string, publicKey: string }, context: Omit<PolicyEnvelopeContext, 'now' | 'requireActive'>) {
  const body = verifyPolicyEnvelopeSignature(value, key)
  const issuedAt = record(body).issuedAt
  return validatePolicyEnvelopeBody(body, { ...context, now: typeof issuedAt === 'number' ? issuedAt : -1, requireActive: false })
}

export function verifyPolicyEnvelope(value: unknown, key: { kid: string, publicKey: string }, context: PolicyEnvelopeContext) {
  return validatePolicyEnvelopeBody(verifyPolicyEnvelopeSignature(value, key), context)
}

function verifyPolicyEnvelopeSignature(value: unknown, key: { kid: string, publicKey: string }): unknown {
  const envelope = record(value)
  exact(envelope, ['schema', 'alg', 'kid', 'body', 'signature'])
  if (envelope.schema !== POLICY_ENVELOPE_SCHEMA || envelope.alg !== 'Ed25519' || !text(envelope.kid)
    || envelope.kid !== key.kid || typeof envelope.body !== 'string'
    || Buffer.byteLength(envelope.body) > POLICY_ENVELOPE_MAX_BYTES
    || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) reject()
  const publicKey = createPublicKey(key.publicKey)
  if (Buffer.from(envelope.signature, 'base64url').toString('base64url') !== envelope.signature) reject()
  if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null,
    Buffer.from(policyEnvelopeSigningInput(envelope.body)), publicKey, Buffer.from(envelope.signature, 'base64url'))) reject()
  return JSON.parse(envelope.body)
}

// `refused` and `invalid` are sticky until a newer signed envelope is stored.
export type PolicyRenewalState = 'ok' | 'platform_unavailable' | 'refused' | 'invalid'
export interface PolicyRenewal {
  state: PolicyRenewalState
  attemptedAt: number
}
export interface PolicyEnvelopeValidity {
  verdict: 'valid' | 'grace' | 'expired' | 'inactive'
  validUntil: number | null
}

/**
 * Timing verdict for an envelope whose signature and binding were already
 * verified. After `expiresAt` the last authentic envelope stays usable only
 * while the syncer keeps recording that Platform is unreachable: at most
 * `issuedAt + POLICY_ENVELOPE_OUTAGE_GRACE_MS`, never past `policyExpiresAt`,
 * and never once renewal was refused or the syncer stopped trying.
 */
export function evaluatePolicyEnvelopeValidity(
  body: Pick<PolicyEnvelopeBody, 'status' | 'issuedAt' | 'expiresAt' | 'policyExpiresAt'>,
  renewal: PolicyRenewal | null,
  now: number
): PolicyEnvelopeValidity {
  const expired: PolicyEnvelopeValidity = { verdict: 'expired', validUntil: null }
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt)
    || (body.policyExpiresAt !== null && !Number.isSafeInteger(body.policyExpiresAt))
    || body.issuedAt > now || body.expiresAt <= body.issuedAt) return expired
  if (body.status !== 'active') return { verdict: 'inactive', validUntil: null }
  const hardLimit = body.policyExpiresAt ?? Number.MAX_SAFE_INTEGER
  if (now < body.expiresAt && now < hardLimit) return { verdict: 'valid', validUntil: Math.min(body.expiresAt, hardLimit) }
  const graceUntil = Math.min(body.issuedAt + POLICY_ENVELOPE_OUTAGE_GRACE_MS, hardLimit)
  if (!renewal || renewal.state !== 'platform_unavailable' || !Number.isSafeInteger(renewal.attemptedAt)
    || renewal.attemptedAt < body.issuedAt || renewal.attemptedAt > now) return expired
  const liveUntil = renewal.attemptedAt + POLICY_ENVELOPE_RENEWAL_LIVENESS_MS
  if (now >= graceUntil || now >= liveUntil) return expired
  return { verdict: 'grace', validUntil: Math.min(graceUntil, liveUntil) }
}
