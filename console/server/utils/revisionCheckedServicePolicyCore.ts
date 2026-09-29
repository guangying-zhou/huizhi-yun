// Service authorization must not turn an unsigned revision hint into a grant.
// The hint only selects an already verified, bounded-age bundle or requires a
// new signed envelope. Any missing dependency fails before evaluation.
export const SERVICE_POLICY_MAX_SIGNED_AGE_MS = 20 * 60 * 1000
export const SERVICE_POLICY_MIN_SIGNED_AGE_MS = 60 * 1000

export interface ServicePolicyBundleIdentity {
  tenantCode: string
  deploymentCode: string
  bundleHash: string
  status: string
  cachedAt: string
  expiresAt: string | null
  policyValidity?: 'valid' | 'grace'
  verifiedEnvelope?: { body: string }
}

export interface ServicePolicyRevisionIdentity {
  policyRevision: number
  payloadHash: string
  status: 'active' | 'suspended' | 'revoked'
}

function verifiedIdentity(bundle: ServicePolicyBundleIdentity | null, tenant: string, deployment: string, now: number, maxSignedAgeMs: number) {
  if (!bundle || bundle.tenantCode !== tenant || bundle.deploymentCode !== deployment
    || bundle.status !== 'active' || bundle.policyValidity !== 'valid') return null
  const acceptedAt = Date.parse(bundle.cachedAt)
  const expiresAt = Date.parse(bundle.expiresAt || '')
  let body: { tenant?: unknown, policyRevision?: unknown, payloadHash?: unknown, status?: unknown } | null = null
  try {
    body = JSON.parse(bundle.verifiedEnvelope?.body || 'null')
  } catch { return null }
  if (!Number.isFinite(acceptedAt) || acceptedAt > now || now - acceptedAt >= maxSignedAgeMs
    || !Number.isFinite(expiresAt) || expiresAt <= now
    || body?.tenant !== tenant || !Number.isSafeInteger(body.policyRevision)
    || Number(body.policyRevision) < 0 || body.payloadHash !== bundle.bundleHash || body.status !== 'active') return null
  return { policyRevision: Number(body.policyRevision), payloadHash: body.payloadHash as string }
}

export async function evaluateWithRevisionCheckedServicePolicy<T>(input: {
  managed: boolean
  tenant: string
  deployment: string
  evaluate: () => Promise<T>
  read: () => Promise<ServicePolicyBundleIdentity | null>
  probe: () => Promise<ServicePolicyRevisionIdentity>
  refresh: () => Promise<{ ok: boolean, bundle: ServicePolicyBundleIdentity | null }>
  maxSignedAgeMs?: number
  now?: () => number
}): Promise<T> {
  if (!input.managed) return input.evaluate()
  try {
    const maxSignedAgeMs = input.maxSignedAgeMs ?? SERVICE_POLICY_MAX_SIGNED_AGE_MS
    if (!Number.isSafeInteger(maxSignedAgeMs) || maxSignedAgeMs < SERVICE_POLICY_MIN_SIGNED_AGE_MS
      || maxSignedAgeMs > SERVICE_POLICY_MAX_SIGNED_AGE_MS) throw Error('invalid_signed_age_limit')
    const now = (input.now || Date.now)()
    const cached = await input.read()
    // Probe even when the cache is absent or too old. A failed probe must not
    // be converted into a full refresh or a stale authorization decision.
    const current = await input.probe()
    if (!Number.isSafeInteger(current.policyRevision) || current.policyRevision < 0
      || !current.payloadHash || !['active', 'suspended', 'revoked'].includes(current.status)) throw Error('invalid_revision_probe')
    if (current.status !== 'active') throw Error('inactive_policy_revision')
    const verified = verifiedIdentity(cached, input.tenant, input.deployment, now, maxSignedAgeMs)
    if (!verified || verified.policyRevision !== current.policyRevision || verified.payloadHash !== current.payloadHash) {
      // A lower revision is a rollback signal, never a reason to load it.
      if (verified && current.policyRevision < verified.policyRevision) throw Error('policy_revision_rollback')
      const refreshed = await input.refresh()
      const next = verifiedIdentity(refreshed.ok ? refreshed.bundle : null,
        input.tenant, input.deployment, (input.now || Date.now)(), maxSignedAgeMs)
      if (!next || next.policyRevision !== current.policyRevision || next.payloadHash !== current.payloadHash) {
        throw Error('policy_revision_refresh_mismatch')
      }
    }
  } catch {
    throw Error('revision_checked_service_policy_unavailable')
  }
  return input.evaluate()
}
