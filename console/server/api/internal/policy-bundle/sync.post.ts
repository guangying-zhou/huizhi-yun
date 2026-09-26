import { createError, defineEventHandler, setHeader } from 'h3'
import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { persistentPolicyStoreEnabled, verifiedPolicyStoreEnabled } from '~~/server/utils/bundleCache'
import { fetchPlatformPolicyRevision, refreshPlatformBundle, registerPlatformConsoleServiceKey } from '~~/server/utils/platformRuntime'
import { loadConsoleServiceKey } from '@hzy/foundation/server/utils/consoleServiceKey'
import { syncVerifiedPolicy } from '~~/server/utils/verifiedPolicyRenewal'
import { currentVerifiedPolicyIdentity, recordVerifiedPolicyRenewal } from '~~/server/utils/verifiedPolicyRuntime'
import { issueConsoleRuntimeServiceToken } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getOidcIssuer } from '~~/server/utils/oidc'
import { verifyPolicyStorageIssuance } from '~~/server/utils/policyStoragePreflight'

function syncFailureReason(error: unknown) {
  return String(error || 'verified policy bundle missing')
    .replace(/https?:\/\/[^\s]+/g, '[url]')
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9._~-]{24,}\b/g, '[redacted]')
    .slice(0, 240)
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const localDiagnostic = process.env.HZY0_LOCAL_CONSOLE_FACADE === 'true'
  let context
  try {
    context = await requireTenantGatewaySchedulerRequest(event, 'console', '/api/internal/policy-bundle/sync')
  } catch (error) {
    if (localDiagnostic) console.warn('Local policy sync stage', { stage: 'scheduler-auth', status: (error as { statusCode?: number }).statusCode || 503, elapsedMs: Date.now() - startedAt })
    throw error
  }
  setHeader(event, 'Cache-Control', 'no-store')
  if (!persistentPolicyStoreEnabled(event)) {
    // Two-phase rollout: verify real grants using the trusted scheduler while
    // ordinary traffic still uses memory. Does not claim a durable package exists.
    const issuer = getOidcIssuer(event)
    const probes = await verifyPolicyStorageIssuance(async (audience, scope) => {
      const response = await issueConsoleRuntimeServiceToken(event, {
        audience, scope, issuer, ttlSeconds: 60, sourceBinding: 'service-client-policy'
      })
      return response.data.accessToken
    }, { ...context, issuer })
    console.info('Policy storage preflight passed', { tenant: context.tenant, probes })
    return { code: 0, data: { ready: false, preflightReady: true } }
  }
  if (verifiedPolicyStoreEnabled(event)) {
    const outcome = await syncVerifiedPolicy({
      now: Date.now,
      current: () => currentVerifiedPolicyIdentity(event),
      probe: () => fetchPlatformPolicyRevision(event),
      refresh: () => refreshPlatformBundle('independent-sync', event),
      record: (state, etag) => recordVerifiedPolicyRenewal(event, state, etag),
      warn: (message, details) => console.warn(message, details),
      serviceKey: () => loadConsoleServiceKey((event.context.cloudflare?.env || {}) as Record<string, unknown>),
      registerServiceKey: publicKey => registerPlatformConsoleServiceKey(event, publicKey)
    })
    if (localDiagnostic) console.info('Local policy sync stage', { stage: 'verified-sync', mode: outcome.mode, elapsedMs: Date.now() - startedAt })
    if (!outcome.ok) {
      console.warn('Policy bundle sync unavailable', { renewal: outcome.renewal, reason: syncFailureReason(outcome.error) })
      throw createError({ statusCode: 503, message: 'policy sync unavailable', data: { code: `policy_sync_${outcome.renewal ?? 'local_failure'}` } })
    }
    return { code: 0, data: { ready: true, mode: outcome.mode, renewAfter: outcome.renewAfter } }
  }
  const result = await refreshPlatformBundle('independent-sync', event)
  if (localDiagnostic) console.info('Local policy sync stage', { stage: 'refresh', ready: result.ok && !!result.bundle, elapsedMs: Date.now() - startedAt })
  if (!result.ok || !result.bundle) {
    console.warn('Policy bundle sync unavailable', { reason: syncFailureReason(result.error) })
    throw createError({ statusCode: 503, message: 'policy sync unavailable' })
  }
  return { code: 0, data: { ready: true } }
})
