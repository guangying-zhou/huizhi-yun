import { useEvent } from 'nitropack/runtime'
import { createError, type H3Event } from 'h3'
import { POLICY_ENVELOPE_LONG_MAX_AGE_MS, verifyPolicyEnvelopeAuthenticity, type PolicyEnvelopeBody, type PolicyRenewalState } from '@hzy/authz-core/policy-envelope'
import { consoleVerifiedPolicyStore } from '@hzy/foundation/server/utils/consoleVerifiedPolicyStore'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import type { PlatformRuntimeConfig } from './platformRuntime'
import type { CachedPolicyBundle } from './bundleCache'
import { policyMaxAgeMs, policyMemoryCacheTtlMs } from './bundleCache'
import { synchronizeVerifiedPolicy, verifiedSnapshotBundle } from './verifiedPolicySync'
import { coalescePolicyRead } from './persistentPolicyBundle'
import { readThroughVerifiedPolicy, rememberSynchronizedPolicy, resetVerifiedPolicyReadCache } from './verifiedPolicyReadCache'
import { logAuthDependencyFailure } from '@hzy/foundation/server/utils/authDependencyDiagnostic'

export function verifiedPolicyTrust(config: PlatformRuntimeConfig, event?: H3Event) {
  let deployment = config.deploymentCode
  if (config.activationMode === 'managed-cloud-multitenant') {
    const gateway = event && resolveTrustedTenantGatewayContext(event)
    if (!gateway || gateway.tenant !== config.tenantCode || gateway.environment !== config.environment) {
      throw createError({ statusCode: 503, message: 'Verified Console policy binding unavailable', data: { code: 'verified_console_context_missing' } })
    }
    // /oauth/token retains the inbound Enterprise identity. The Console store
    // still belongs to Console, whose binding comes from the trusted catalog;
    // do not compare its receipt against the caller deployment or rewrite it.
    deployment = gateway.appCode === 'console'
      ? gateway.deployment
      : resolveTrustedServiceAppRoute(event, 'console')?.deploymentCode || ''
    if (!deployment) throw createError({ statusCode: 503, message: 'Verified Console policy binding unavailable', data: { code: 'verified_console_route_missing' } })
  }
  return {
    key: { kid: config.signingKid, publicKey: config.signingPubkey },
    context: { issuer: new URL(config.baseUrl).origin, tenant: config.tenantCode, environment: config.environment,
      // Test keeps its configured lease; every other environment accepts the
      // 60-minute signed lease. Legacy HMAC bundles keep their own limit.
      deployment, maxAgeMs: config.environment === 'test' ? policyMaxAgeMs(event) : POLICY_ENVELOPE_LONG_MAX_AGE_MS }
  }
}

async function dependencies(inputEvent?: H3Event) {
  const event = inputEvent || useEvent()
  const { loadPlatformRuntimeConfig } = await import('./platformRuntime')
  const trust = verifiedPolicyTrust(loadPlatformRuntimeConfig(event), event)
  return { ...trust, store: consoleVerifiedPolicyStore(event) }
}

export async function readVerifiedConsolePolicy(event?: H3Event) {
  const request = event || useEvent()
  const startedAt = Date.now()
  let resolved: Awaited<ReturnType<typeof dependencies>>
  try {
    resolved = await dependencies(request)
  } catch (error) {
    logAuthDependencyFailure(request, 'verified-policy-binding', error, Date.now() - startedAt)
    throw error
  }
  const { key, context, store } = resolved
  const readKey = verifiedPolicyReadKey(key, context)
  return readThroughVerifiedPolicy(readKey, policyMemoryCacheTtlMs(request), async () => {
    let snapshot
    try {
      snapshot = await coalescePolicyRead(request, readKey, () => store.get())
    } catch (error) {
      logAuthDependencyFailure(request, 'verified-policy-store', error, Date.now() - startedAt)
      throw error
    }
    if (!snapshot) {
      logAuthDependencyFailure(request, 'verified-policy-missing', { statusCode: 404 }, Date.now() - startedAt)
      return null
    }
    try {
      const bundle = verifiedSnapshotBundle(snapshot, key, { ...context, now: Date.now() })
      if (bundle.policyValidity === 'grace') {
        // Serving the last authentic policy because Platform is unreachable.
        console.warn(JSON.stringify({ event: 'console-policy-outage-grace', stage: 'verified-policy-grace',
          validUntil: bundle.expiresAt, renewalAttemptedAt: snapshot.renewal?.attemptedAt ?? null }))
      }
      return bundle
    } catch {
      logAuthDependencyFailure(request, 'verified-policy-invalid', { statusCode: 503 }, Date.now() - startedAt)
      throw createError({ statusCode: 503, message: 'Verified policy is invalid or expired', data: { code: 'verified_console_policy_receipt_invalid' } })
    }
  })
}

export async function writeVerifiedConsolePolicy(bundle: CachedPolicyBundle, event?: H3Event) {
  if (!bundle.verifiedEnvelope) throw Error('signed_policy_envelope_required')
  const { key, context, store } = await dependencies(event)
  let synchronized
  try {
    synchronized = await synchronizeVerifiedPolicy(store, bundle.verifiedEnvelope, key, context)
  } catch (error) {
    // A stored signed suspension/revocation (or any unusable receipt) must not
    // leave an older active view in the cross-request cache.
    resetVerifiedPolicyReadCache()
    throw error
  }
  rememberSynchronizedPolicy(verifiedPolicyReadKey(key, context), synchronized)
  return synchronized
}

function verifiedPolicyReadKey(key: unknown, context: unknown) {
  return JSON.stringify(['verified-policy', key, context])
}

// Syncer-only helpers. The snapshot identity is authenticity-checked but carries
// no lifecycle verdict; it only tells the syncer what Runtime currently holds.
export async function currentVerifiedPolicyIdentity(event: H3Event): Promise<{ etag: string, body: PolicyEnvelopeBody } | null> {
  const { key, context, store } = await dependencies(event)
  const snapshot = await store.get()
  if (!snapshot) return null
  return { etag: snapshot.etag, body: verifyPolicyEnvelopeAuthenticity(snapshot.envelope, key, context) }
}

export async function recordVerifiedPolicyRenewal(event: H3Event, state: PolicyRenewalState, expectedEtag: string) {
  const { store } = await dependencies(event)
  return store.recordRenewal(state, expectedEtag)
}
