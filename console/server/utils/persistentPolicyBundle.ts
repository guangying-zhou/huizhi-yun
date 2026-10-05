import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const POLICY_MAX_AGE_MS = 300_000
export const TEST_POLICY_MAX_AGE_MS = 26 * 60 * 60 * 1_000

// The longer test window is opt-in at the Console boundary. Keep the parser
// here so durable reads and isolate memory use one bounded value.
export function boundedPolicyMaxAgeMs(value: unknown) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > TEST_POLICY_MAX_AGE_MS) return POLICY_MAX_AGE_MS
  return parsed
}

export interface PolicyObjectStore {
  get(key: string): Promise<{ text(): Promise<string>, etag: string } | null>
  put(key: string, body: string, options: { onlyIf: { etagMatches?: string, etagDoesNotMatch?: string } }): Promise<unknown | null>
}

function objectKey(scope: string) {
  if (!scope) throw new Error('policy store scope required')
  return `policy/v1/${createHash('sha256').update(scope).digest('hex')}.json`
}

function mac(secret: string, body: string) {
  if (!secret) throw new Error('policy store integrity key required')
  return createHmac('sha256', secret).update(body).digest('hex')
}

function decode<T>(raw: string, scope: string, secret: string): { syncedAt: number, value: T } {
  const envelope = JSON.parse(raw)
  const expected = Buffer.from(mac(secret, envelope.body), 'hex')
  const received = Buffer.from(String(envelope.mac || ''), 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('policy store integrity failed')
  const record = JSON.parse(envelope.body)
  if (record.scope !== scope || !Number.isSafeInteger(record.syncedAt)) throw new Error('policy store context invalid')
  return record
}

type BundleRecord = Record<string, unknown>
function object(value: unknown): BundleRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as BundleRecord : null
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = object(value)
  if (record) return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function enterpriseEvidence(value: unknown) {
  const bundle = object(value), payload = object(bundle?.payload)
  if (!payload || !Object.hasOwn(payload, 'enterpriseEntitlement')) return null
  const entitlement = object(payload.enterpriseEntitlement)
  const revision = entitlement?.revision, policyRevision = payload.policyRevision
  if (!entitlement || !Number.isSafeInteger(revision) || Number(revision) < 1
    || !Number.isSafeInteger(policyRevision) || Number(policyRevision) < 1
    || typeof bundle?.tenantCode !== 'string' || bundle.tenantCode !== entitlement.tenantCode) {
    throw new Error('enterprise durable revision evidence invalid')
  }
  const qualification = { ...entitlement }
  delete qualification.effectiveStatus
  // generatedAt is regenerated without changing signed policy facts. policyRevision
  // is the Platform DB sequence, not a local clock or mutable sync timestamp.
  const facts = { ...payload }
  delete facts.generatedAt
  delete facts.policyRevision
  return { tenant: bundle.tenantCode, revision: Number(revision), policyRevision: Number(policyRevision),
    qualificationHash: createHash('sha256').update(canonical(qualification)).digest('hex'),
    policyFactsHash: createHash('sha256').update(canonical(facts)).digest('hex') }
}
function assertDurableTransition(before: ReturnType<typeof enterpriseEvidence>, after: ReturnType<typeof enterpriseEvidence>) {
  if (!before) return
  if (!after || after.tenant !== before.tenant || after.revision < before.revision || after.policyRevision < before.policyRevision) {
    throw new Error('enterprise durable revision rollback rejected')
  }
  if (after.revision === before.revision && after.qualificationHash !== before.qualificationHash) {
    throw new Error('enterprise same revision qualification conflict')
  }
  if (after.policyRevision === before.policyRevision && after.policyFactsHash !== before.policyFactsHash) {
    throw new Error('enterprise same policy revision content conflict')
  }
}

// Only the independent synchronizer writes these records after Platform signature
// verification. HMAC seals the full metadata as well as the signed payload.
export async function storePolicyBundle<T>(store: PolicyObjectStore, scope: string, secret: string, value: T, syncedAt: number) {
  // Computing policyFactsHash canonicalizes the complete signed policy payload.
  // Keep the evidence for this candidate across CAS retries: it is immutable for
  // this call, while each fetched predecessor still needs one fresh check.
  const nextEvidence = enterpriseEvidence(value)
  const key = objectKey(scope)
  const record = { scope, syncedAt, value }
  let encoded: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await store.get(key)
    if (current) {
      // The persisted signed bundle is also the monotonic watermark, even after
      // its read TTL. An unreadable record cannot safely be reset during rotation.
      const previous = decode<T>(await current.text(), scope, secret)
      const previousEvidence = enterpriseEvidence(previous.value)
      assertDurableTransition(previousEvidence, nextEvidence)
      const advanced = previousEvidence && nextEvidence && nextEvidence.policyRevision > previousEvidence.policyRevision
      if (previous.syncedAt > syncedAt || (previous.syncedAt === syncedAt && !advanced)) return previous
    }
    if (!encoded) {
      const body = JSON.stringify(record)
      encoded = JSON.stringify({ body, mac: mac(secret, body) })
    }
    const result = await store.put(key, encoded, {
      onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' }
    })
    if (result !== null) return record
  }
  throw new Error('policy store concurrent update; retry sync')
}

export async function readPolicyBundle<T>(store: PolicyObjectStore, scope: string, secret: string, now = Date.now(), maxAgeMs = POLICY_MAX_AGE_MS) {
  const object = await store.get(objectKey(scope))
  if (!object) return null
  const record = decode<T>(await object.text(), scope, secret)
  const effectiveMaxAgeMs = boundedPolicyMaxAgeMs(maxAgeMs)
  if (record.syncedAt > now || now - record.syncedAt >= effectiveMaxAgeMs) return null
  return record
}

// Pending I/O is shared only within one request, never between Worker requests.
const pendingReads = new WeakMap<object, Map<string, Promise<unknown>>>()
export function coalescePolicyRead<T>(request: object, key: string, read: () => Promise<T>): Promise<T> {
  let reads = pendingReads.get(request)
  if (!reads) pendingReads.set(request, reads = new Map())
  const pending = reads.get(key)
  if (pending) return pending as Promise<T>
  const result = Promise.resolve().then(read).finally(() => {
    if (reads!.get(key) === result) reads!.delete(key)
  })
  reads.set(key, result)
  return result
}
