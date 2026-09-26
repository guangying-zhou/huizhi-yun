import { createError, type H3Event } from 'h3'
import type { PolicyEnvelopeContext } from '@hzy/authz-core/policy-envelope'
import { maybeCallTenantRuntime } from './tenantRuntimeClient'
import { verifyRuntimePolicySnapshot } from './verifiedPolicySnapshot'

// This is a narrow Console-domain reader, not the Console service client.
// No object/URL/deployment selection is sent to Runtime. Host identity is retained.
export async function readEnterprisePolicySnapshot(event: H3Event, key: { kid: string, publicKey: string }, context: Omit<PolicyEnvelopeContext, 'now'>) {
  const response = await maybeCallTenantRuntime<{ code: number, data: Parameters<typeof verifyRuntimePolicySnapshot>[0] }>(event, '/v1/enterprise/console-policy', {
    appCode: 'enterprise', scope: 'console:policy-bundle:read', capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'GET', query: {}, timeoutMs: 5000
  })
  if (!response.handled || response.data?.code !== 0) {
    throw createError({ statusCode: 503, message: 'Verified policy reader unavailable', data: { code: 'enterprise_policy_reader_unavailable' } })
  }
  try {
    const verified = verifyRuntimePolicySnapshot(response.data.data, key, { ...context, now: Date.now() })
    if (verified.validity === 'grace') {
      // Serving the last authentic policy because Platform is unreachable.
      console.warn(JSON.stringify({ event: 'enterprise-policy-outage-grace', stage: 'enterprise-policy-grace', validUntil: verified.validUntil }))
    }
    return verified
  } catch {
    throw createError({ statusCode: 503, message: 'Verified policy is invalid or expired', data: { code: 'enterprise_policy_invalid_or_expired' } })
  }
}
