import type { H3Event } from 'h3'
import type { PolicyEnvelope, PolicyRenewal, PolicyRenewalState } from '@hzy/authz-core/policy-envelope'
import type { verifyRuntimePolicySnapshot } from './verifiedPolicySnapshot'
import { callConsoleTenantRuntime, type ConsoleTenantRuntimeEnvelope } from './consoleTenantRuntimeClient'

export type VerifiedPolicySnapshot = Parameters<typeof verifyRuntimePolicySnapshot>[0]

export function consoleVerifiedPolicyStore(event: H3Event) {
  const call = async (method: 'GET' | 'PUT', body?: unknown) => {
    const response = await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<VerifiedPolicySnapshot>>(
      event, '/v1/console/verified-policy', {
        scope: method === 'GET' ? 'console:policy-bundle:read' : 'console:policy-bundle:write',
        serviceTokenSourceBinding: 'service-client-policy', method, query: {}, body, timeoutMs: 5000
      })
    if (response.code !== 0 || !response.data) throw new Error('policy_snapshot_unavailable')
    return response.data
  }
  return {
    async get() {
      try {
        return await call('GET')
      } catch (error) {
        const failure = error as { statusCode?: number, data?: { code?: string } }
        // Only an authenticated, explicit missing row permits first creation.
        if (failure.statusCode === 404 && failure.data?.code === 'policy_snapshot_missing') return null
        throw error
      }
    },
    put(envelope: PolicyEnvelope, expectedEtag: string) {
      // Runtime uses signed content identity for replay; no timestamp is changed.
      return call('PUT', { envelope, expectedEtag })
    },
    // Syncer-only: record the Platform renewal outcome for the snapshot with
    // this ETag. Runtime supplies the attempt time; callers cannot set it.
    async recordRenewal(state: PolicyRenewalState, expectedEtag: string) {
      const response = await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ etag: string, renewal: PolicyRenewal }>>(
        event, '/v1/console/verified-policy/renewal', {
          scope: 'console:policy-bundle:write', serviceTokenSourceBinding: 'service-client-policy',
          method: 'PUT', query: {}, body: { state, expectedEtag }, timeoutMs: 5000
        })
      if (response.code !== 0 || !response.data) throw new Error('policy_renewal_unavailable')
      return response.data.renewal
    }
  }
}
