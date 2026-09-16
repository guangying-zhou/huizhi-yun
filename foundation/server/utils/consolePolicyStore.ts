import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { callConsoleTenantRuntime, type ConsoleTenantRuntimeEnvelope } from './consoleTenantRuntimeClient'

// Domain-specific CAS storage, never a generic database/table proxy.
export function consolePolicyStore(event: H3Event) {
  return {
    async get(key: string) {
      const response = await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ body: string, etag: string } | null>>(
        event, '/v1/console/policy-bundle', {
          scope: 'console:policy-bundle:read', serviceTokenSourceBinding: 'service-client-policy',
          method: 'GET', query: { key }
        })
      const record = response.data
      return record ? { etag: record.etag, text: async () => record.body } : null
    },
    async put(key: string, body: string, options: { onlyIf: { etagMatches?: string, etagDoesNotMatch?: string } }) {
      const expectedEtag = options.onlyIf.etagMatches || ''
      if (!expectedEtag && options.onlyIf.etagDoesNotMatch !== '*') throw new Error('policy CAS condition required')
      const idempotencyKey = createHash('sha256').update(JSON.stringify({ key, body, expectedEtag })).digest('hex')
      const response = await callConsoleTenantRuntime<ConsoleTenantRuntimeEnvelope<{ stored: boolean }>>(
        event, '/v1/console/policy-bundle', {
          scope: 'console:policy-bundle:write', serviceTokenSourceBinding: 'service-client-policy',
          method: 'PUT', query: {}, body: { key, body, expectedEtag }, idempotencyKey
        })
      return response.data.stored ? response.data : null
    }
  }
}
