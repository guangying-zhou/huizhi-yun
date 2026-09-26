import { createError, type H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { readEnterprisePolicySnapshot } from '@hzy/foundation/server/utils/enterprisePolicyReader'

// Opt-in rollout gate; does not replace Console's existing role/scope evaluator.
export async function requireCurrentEnterprisePolicy(event: H3Event, user: { tenant: string, policyVersion?: string | null }) {
  const cfg = useRuntimeConfig(event).verifiedPolicy
  if (cfg?.enabled !== true) return
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (!gateway || gateway.appCode !== 'enterprise' || gateway.tenant !== user.tenant || !gateway.deployment) {
    throw createError({ statusCode: 503, message: 'Verified Enterprise deployment required for policy reader', data: { code: 'enterprise_policy_deployment_required' } })
  }
  const verified = await readEnterprisePolicySnapshot(event, { kid: cfg.kid, publicKey: cfg.publicKey }, {
    issuer: cfg.issuer, tenant: gateway.tenant, environment: cfg.environment, deployment: gateway.deployment,
    maxAgeMs: cfg.maxAgeMs
  })
  // A still-valid session issued under an older policy: the client renews its
  // access token (same session) and retries; it is not a sign-out.
  if (user.policyVersion !== verified.body.bundleVersion) {
    throw createError({ statusCode: 401, message: 'Session policy version has changed; token renewal required', data: { code: 'enterprise_policy_version_changed' } })
  }
}
