export interface ServiceGrantPolicyBinding {
  tenantCode: string
  deploymentCode: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function parseScopeJson(value: string | Record<string, unknown> | null) {
  if (!value) return null
  const parsed = typeof value === 'string'
    ? JSON.parse(value) as Record<string, unknown>
    : value
  const tenantCode = text(parsed.tenantCode)
  const deploymentCode = text(parsed.deploymentCode)
  if (!tenantCode && !deploymentCode) return null
  if (!tenantCode || !deploymentCode) {
    throw new Error('service grant policy binding is incomplete')
  }
  return { tenantCode, deploymentCode }
}

export function resolveServiceGrantPolicyBinding(
  values: Array<string | Record<string, unknown> | null>
): ServiceGrantPolicyBinding | null {
  const bindings = values
    .map(parseScopeJson)
    .filter((binding): binding is ServiceGrantPolicyBinding => Boolean(binding))
  const unique = new Map(bindings.map(binding => [`${binding.tenantCode}\0${binding.deploymentCode}`, binding]))
  if (unique.size > 1) {
    throw new Error('service grants have conflicting policy bindings')
  }
  return unique.values().next().value || null
}
