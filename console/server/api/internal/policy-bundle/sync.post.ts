import { createError, defineEventHandler, setHeader } from 'h3'
import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { persistentPolicyStoreEnabled } from '~~/server/utils/bundleCache'
import { refreshPlatformBundle } from '~~/server/utils/platformRuntime'
import { issueConsoleRuntimeServiceToken } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getOidcIssuer } from '~~/server/utils/oidc'
import { verifyPolicyStorageIssuance } from '~~/server/utils/policyStoragePreflight'

export default defineEventHandler(async (event) => {
  const context = await requireTenantGatewaySchedulerRequest(event, 'console', '/api/internal/policy-bundle/sync')
  setHeader(event, 'Cache-Control', 'no-store')
  if (!persistentPolicyStoreEnabled()) {
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
  const result = await refreshPlatformBundle('independent-sync', event)
  if (!result.ok || !result.bundle) throw createError({ statusCode: 503, message: 'policy sync unavailable' })
  return { code: 0, data: { ready: true } }
})
