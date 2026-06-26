export type HzyDeploymentProfile
  = | 'dev'
    | 'managed-cloud-agent'
    | 'managed-cloud-direct-db'
    | 'managed-cloud-d1'
    | 'self-hosted'
    | 'platform-cloud-db'
    | 'platform-self-hosted-db'
    | 'platform-d1'

const managedCloudProfiles = new Set<string>([
  'managed-cloud-agent',
  'managed-cloud-direct-db',
  'managed-cloud-d1'
])

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    const normalized = stringValue(current)
    if (normalized) return normalized
  }

  return ''
}

export function resolveDeploymentProfile(config = useRuntimeConfig() as unknown as Record<string, unknown>): HzyDeploymentProfile {
  const explicit = getConfigValue(config, [
    'hzy.deploymentProfile',
    'public.deploymentProfile'
  ]) || process.env.HZY_DEPLOYMENT_PROFILE || process.env.DEPLOYMENT_PROFILE

  if (explicit) return explicit as HzyDeploymentProfile
  if (process.env.HZY_CLOUDFLARE_BUILD === 'true' || process.env.HZY_CLOUDFLARE_RUNTIME === 'true') {
    return 'managed-cloud-direct-db'
  }
  if (process.env.NODE_ENV === 'production') return 'self-hosted'
  return 'dev'
}

export function isManagedCloudProfile(profile = resolveDeploymentProfile()) {
  return managedCloudProfiles.has(profile)
}

export function isSelfHostedProfile(profile = resolveDeploymentProfile()) {
  return profile === 'self-hosted' || profile === 'platform-self-hosted-db'
}
