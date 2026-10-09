export interface PolicyRevisionIdentity {
  policyRevision: number
  payloadHash: string
  status: 'active' | 'suspended' | 'revoked'
}

export function parsePolicyRevisionResponse(response: unknown, binding: {
  managed: boolean
  tenant: string
  environment: string
  deployment: string
}): PolicyRevisionIdentity | null {
  if (!response || typeof response !== 'object') return null
  const outer = response as Record<string, unknown>
  if (binding.managed ? outer.success !== true : outer.code !== 0) return null
  if (!outer.data || typeof outer.data !== 'object') return null
  const data = outer.data as Record<string, unknown>
  if (data.tenant !== binding.tenant || data.environment !== binding.environment
    || data.deployment !== binding.deployment || !Number.isSafeInteger(data.policyRevision)
    || Number(data.policyRevision) < 0 || typeof data.payloadHash !== 'string' || !data.payloadHash
    || !['active', 'suspended', 'revoked'].includes(String(data.status))) return null
  return {
    policyRevision: data.policyRevision as number,
    payloadHash: data.payloadHash,
    status: data.status as PolicyRevisionIdentity['status']
  }
}
