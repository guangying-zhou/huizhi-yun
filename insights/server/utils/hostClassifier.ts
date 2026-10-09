export type HostKind = 'platform-root' | 'platform-reserved-subdomain' | 'tenant-subdomain' | 'custom-domain'

export interface HostClassification {
  kind: HostKind
  host: string
  baseDomain?: string
  subdomain?: string
  tenantName?: string
  isRootLike: boolean
}

export interface HostClassifierOptions {
  platformBaseDomains?: unknown
  reservedSubdomains?: unknown
}

export interface RuntimeHostConfig {
  platformBaseDomains?: unknown
  platformReservedSubdomains?: unknown
}

function toList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean)
  }

  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export function normalizeHost(value: unknown) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.+$/, '')
  if (!raw) return ''

  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const hostname = withoutProtocol.split('/')[0] || ''
  return hostname.replace(/:\d+$/, '').replace(/\.+$/, '')
}

function normalizedBaseDomains(value: unknown) {
  return toList(value)
    .map(normalizeHost)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
}

function normalizedReservedSubdomains(value: unknown) {
  return new Set(toList(value).map(item => item.toLowerCase()))
}

function customDomain(host: string, baseDomain?: string): HostClassification {
  return {
    kind: 'custom-domain',
    host,
    baseDomain,
    isRootLike: false
  }
}

export function classifyHost(hostValue: unknown, options: HostClassifierOptions = {}): HostClassification {
  const host = normalizeHost(hostValue)
  if (!host) return customDomain('')

  const baseDomains = normalizedBaseDomains(options.platformBaseDomains)
  const reservedSubdomains = normalizedReservedSubdomains(options.reservedSubdomains)

  for (const baseDomain of baseDomains) {
    if (host === baseDomain || host === `www.${baseDomain}`) {
      return {
        kind: 'platform-root',
        host,
        baseDomain,
        subdomain: host === baseDomain ? '' : 'www',
        isRootLike: true
      }
    }

    if (!host.endsWith(`.${baseDomain}`)) continue

    const subdomain = host.slice(0, -1 * (`.${baseDomain}`).length)
    if (!subdomain || subdomain.includes('.')) {
      return customDomain(host, baseDomain)
    }

    if (reservedSubdomains.has(subdomain)) {
      return {
        kind: 'platform-reserved-subdomain',
        host,
        baseDomain,
        subdomain,
        isRootLike: false
      }
    }

    return {
      kind: 'tenant-subdomain',
      host,
      baseDomain,
      subdomain,
      tenantName: subdomain,
      isRootLike: false
    }
  }

  return customDomain(host)
}

export function classifyHostWithRuntime(host: unknown, runtimePublic: RuntimeHostConfig = {}) {
  return classifyHost(host, {
    platformBaseDomains: runtimePublic.platformBaseDomains,
    reservedSubdomains: runtimePublic.platformReservedSubdomains
  })
}
