import type { PolicyEnvelopeBody, PolicyRenewalState } from '@hzy/authz-core/policy-envelope'
import type { PlatformPolicyRevision, RefreshBundleResult } from './platformRuntime'

// A current envelope older than this is renewed even when nothing changed,
// leaving three further attempts before a 60-minute lease expires.
export const POLICY_RENEWAL_INTERVAL_MS = 15 * 60_000
// Platform signs 5-minute leases outside test (Runtime accepts no more than that), so a fixed 15-minute interval would leave the
// stored envelope expired for two thirds of the time. The interval follows the lease: half of it, capped at 15 minutes (60-minute and
// longer leases renew as before) and floored so an abnormal lease cannot cause constant refreshes.
export const POLICY_RENEWAL_MIN_INTERVAL_MS = 30_000

export function policyRenewalIntervalMs(issuedAt: unknown, expiresAt: unknown, warn?: (message: string, details: Record<string, unknown>) => void) {
  const lease = Number(expiresAt) - Number(issuedAt)
  if (!Number.isFinite(lease) || lease <= 0 || issuedAt === null || expiresAt === null || issuedAt === undefined || expiresAt === undefined) {
    warn?.('Policy lease is missing or invalid; using the fixed renewal interval', { code: 'policy_lease_invalid' })
    return POLICY_RENEWAL_INTERVAL_MS
  }
  return Math.max(POLICY_RENEWAL_MIN_INTERVAL_MS, Math.min(POLICY_RENEWAL_INTERVAL_MS, Math.floor(lease / 2)))
}

// renewAfter of a just-renewed envelope comes from the stored envelope (issuedAt/expiresAt of its body); the bundle view is only the
// fallback when the envelope cannot be read back (a production policy bundle can carry expiresAt: null).
async function renewedRenewAfter(deps: VerifiedPolicySyncDependencies, bundle: { generatedAt: string | null, expiresAt: string | null }) {
  const stored = await deps.current().catch(() => null)
  if (stored?.body) return stored.body.issuedAt + policyRenewalIntervalMs(stored.body.issuedAt, stored.body.expiresAt, deps.warn)
  const issuedAt = Date.parse(bundle.generatedAt || '')
  return Number.isFinite(issuedAt) ? issuedAt + bundleRenewalIntervalMs(bundle, deps.warn) : null
}

function bundleRenewalIntervalMs(bundle: { generatedAt: string | null, expiresAt: string | null }, warn?: (message: string, details: Record<string, unknown>) => void) {
  return policyRenewalIntervalMs(bundle.generatedAt ? Date.parse(bundle.generatedAt) : null, bundle.expiresAt ? Date.parse(bundle.expiresAt) : null, warn)
}

export type PolicyRenewalFailure = Exclude<PolicyRenewalState, 'ok'>

// Steady service key (R1): registered while missing from the stored envelope
// or within this window of its notAfter; attempts are spaced so a Platform
// without the registration endpoint is not called every minute.
export const SERVICE_KEY_RENEW_BEFORE_MS = 30 * 86_400_000
export const SERVICE_KEY_RETRY_MS = 15 * 60_000
const serviceKeyAttempts = new Map<string, number>()
// Successful registrations: until the re-signed envelope arrives, each sync
// re-fetches it (bounded by SERVICE_KEY_RETRY_MS).
const serviceKeyRegistered = new Map<string, number>()
export function resetServiceKeyAttempts() {
  serviceKeyAttempts.clear()
  serviceKeyRegistered.clear()
}

/**
 * Only evidence about Platform itself is recorded:
 * - `platform` stage: authenticated 4xx (including 401, excluding 408/429) is
 *   an explicit refusal; timeouts, network errors, 5xx, 408 and 429 mean
 *   Platform is unavailable (the only state that can grant outage grace).
 * - `protocol` stage: Platform answered but the response failed format,
 *   binding or signature checks. Recorded as `invalid`, never as an outage.
 * - Anything else (Runtime persistence, CAS, local configuration) is not
 *   Platform evidence: returns null and records nothing.
 */
export function classifyPolicyRenewalFailure(error: unknown): PolicyRenewalFailure | null {
  const failure = error as { policyStage?: unknown, statusCode?: unknown, status?: unknown, response?: { status?: unknown } } | null
  if (failure?.policyStage === 'protocol') return 'invalid'
  if (failure?.policyStage !== 'platform') return null
  const status = Number(failure?.statusCode ?? failure?.status ?? failure?.response?.status)
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429
    ? 'refused'
    : 'platform_unavailable'
}

export interface VerifiedPolicySyncDependencies {
  now: () => number
  current: () => Promise<{ etag: string, body: PolicyEnvelopeBody } | null>
  probe: () => Promise<PlatformPolicyRevision>
  refresh: () => Promise<RefreshBundleResult>
  record: (state: PolicyRenewalState, etag: string) => Promise<unknown>
  warn: (message: string, details: Record<string, unknown>) => void
  /** This Console's steady service key, when configured. */
  serviceKey?: () => Promise<{ kid: string, publicKey: string } | null>
  registerServiceKey?: (publicKey: string) => Promise<unknown>
}

/**
 * Registers the configured key when the stored envelope does not carry it (or
 * it nears notAfter). Returns true when a full renewal should be attempted so
 * the newly signed key reaches Runtime. Never affects the renewal state.
 */
async function ensureServiceKey(deps: VerifiedPolicySyncDependencies, body: PolicyEnvelopeBody | undefined) {
  if (!deps.serviceKey || !deps.registerServiceKey) return false
  let key: { kid: string, publicKey: string } | null
  try {
    key = await deps.serviceKey()
  } catch {
    deps.warn('Console service key unavailable', { stage: 'load' })
    return false
  }
  const now = deps.now()
  if (!key || body?.serviceKeys?.some(item => item.kid === key.kid && item.notAfter - now > SERVICE_KEY_RENEW_BEFORE_MS)) return false
  if (now - (serviceKeyAttempts.get(key.kid) ?? -Infinity) < SERVICE_KEY_RETRY_MS) {
    return now - (serviceKeyRegistered.get(key.kid) ?? -Infinity) < SERVICE_KEY_RETRY_MS
  }
  serviceKeyAttempts.set(key.kid, now)
  try {
    // false: this Console has no registration path (not an error).
    if ((await deps.registerServiceKey(key.publicKey)) === false) return false
    serviceKeyRegistered.set(key.kid, now)
    return true
  } catch (error) {
    deps.warn('Console service key registration failed', { kid: key.kid, status: (error as { statusCode?: number })?.statusCode || 503 })
    return false
  }
}

// renewAfter: when the stored envelope is due for renewal, so a scheduler that
// prepares envelopes ahead of time (hzy0 Gateway) knows when to fetch one.
export type VerifiedPolicySyncResult
  = | { ok: true, mode: 'unchanged' | 'renewed', renewAfter: number | null }
    | { ok: false, mode: 'failed', renewal: PolicyRenewalFailure | null, error: string | null }

/**
 * Scheduled check: a lightweight revision probe decides whether the full
 * signed envelope is fetched. The probe is an optimization only: any probe
 * failure falls through to the full fetch, whose outcome is what gets recorded.
 */
export async function syncVerifiedPolicy(deps: VerifiedPolicySyncDependencies): Promise<VerifiedPolicySyncResult> {
  const current = await deps.current()
  const record = (renewal: PolicyRenewalState, etag: string) => deps.record(renewal, etag).catch((error: unknown) => {
    deps.warn('Policy renewal state not recorded', { renewal, status: (error as { statusCode?: number })?.statusCode || 503 })
  })
  const keyRegistered = await ensureServiceKey(deps, current?.body)
  if (current) {
    let probe: PlatformPolicyRevision | null = null
    try {
      probe = await deps.probe()
    } catch (error) {
      // The probe is optional: outages and malformed probes (e.g. a Platform
      // without the probe format) fall through to the full fetch. An explicit
      // refusal is decisive and must not be replaced by a later fetch result.
      if (classifyPolicyRenewalFailure(error) === 'refused') {
        await record('refused', current.etag)
        return { ok: false, mode: 'failed', renewal: 'refused', error: error instanceof Error ? error.message : null }
      }
    }
    const now = deps.now()
    if (probe && probe.policyRevision === current.body.policyRevision && probe.payloadHash === current.body.payloadHash
      && probe.status === current.body.status && now - current.body.issuedAt < policyRenewalIntervalMs(current.body.issuedAt, current.body.expiresAt, deps.warn)
      && now < current.body.expiresAt) {
      if (keyRegistered) {
        // Registration can change the envelope without changing the policy
        // revision. This is still a full refresh, so classify and record its
        // failure exactly as the ordinary renewal below.
        const renewed = await deps.refresh()
        if (renewed.ok && renewed.bundle) {
          return { ok: true, mode: 'renewed', renewAfter: await renewedRenewAfter(deps, renewed.bundle) }
        }
        const renewal = classifyPolicyRenewalFailure(renewed.cause)
        if (renewal) await record(renewal, current.etag)
        return { ok: false, mode: 'failed', renewal, error: renewed.error }
      }
      // The stored envelope stays valid; a lost state write only delays liveness.
      await record('ok', current.etag)
      return { ok: true, mode: 'unchanged', renewAfter: current.body.issuedAt + policyRenewalIntervalMs(current.body.issuedAt, current.body.expiresAt, deps.warn) }
    }
  }
  const result = await deps.refresh()
  if (result.ok && result.bundle) {
    return { ok: true, mode: 'renewed', renewAfter: await renewedRenewAfter(deps, result.bundle) }
  }
  const renewal = classifyPolicyRenewalFailure(result.cause)
  // Without a stored snapshot there is nothing to grant grace to; local
  // failures are not Platform evidence and leave the recorded state as is.
  if (current && renewal) await record(renewal, current.etag)
  return { ok: false, mode: 'failed', renewal, error: result.error }
}
