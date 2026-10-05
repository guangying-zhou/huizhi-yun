export type RouteRegistry = Record<string, string[]>
export interface ApplicationShellMigrationMetadata {
  version?: number
  appCode?: string
  deploymentCode?: string
  consoleDeploymentCode?: string
  pages?: RouteRegistry
  entries?: Record<string, string>
}

function text(value: unknown) { return String(value || '').trim() }
function registeredPath(pathname: string, pattern: string) {
  const actual = pathname.split('/').filter(Boolean)
  const expected = pattern.split('/').filter(Boolean)
  return actual.length === expected.length && expected.every((segment, index) => segment.startsWith(':') || segment === actual[index])
}

export function resolveApplicationShellMigrationTarget(input: {
  metadata: ApplicationShellMigrationMetadata
  consoleDeployment: string
  appCode: unknown
  requested: unknown
  origin: string
}) {
  const { metadata, consoleDeployment, origin } = input
  if (!metadata || typeof metadata !== 'object' || metadata.version !== 1 || metadata.appCode !== 'enterprise' || metadata.consoleDeploymentCode !== consoleDeployment
    || !metadata.deploymentCode || !metadata.pages || !metadata.entries || !origin) return null
  const appCode = text(input.appCode).toLowerCase()
  const patterns = metadata.pages[appCode]
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appCode) || !Object.hasOwn(metadata.pages, appCode)
    || !Array.isArray(patterns) || !patterns.length || patterns.some(pattern => typeof pattern !== 'string')) return null
  const requested = text(input.requested) || text(metadata.entries[appCode])
  if (!requested || /[\\\u0000-\u0020]/.test(requested)) return null
  let target: URL
  try { target = new URL(requested, origin) } catch { return null }
  try {
    const path = decodeURIComponent(target.pathname)
    if (/[\\\u0000-\u0020]/.test(path) || /%2f|%5c|%2e/i.test(target.pathname)
      || path.split('/').some(segment => segment === '.' || segment === '..')) return null
  } catch { return null }
  if (target.origin !== origin || /\/(?:api|oauth|oidc)(?:\/|$)/i.test(target.pathname)) return null
  if (target.pathname === `/${appCode}` || target.pathname === `/${appCode}/`) {
    const entry = text(metadata.entries[appCode])
    if (!entry.startsWith(`/${appCode}/`) && entry !== `/${appCode}`) return null
    target.pathname = entry
  }
  if (!patterns.some(pattern => registeredPath(target.pathname, pattern))) return null
  target.searchParams.delete('hzy_embed')
  target.searchParams.delete('standalone')
  return { target: `${target.pathname}${target.search}${target.hash}`, release: metadata.deploymentCode }
}

// Deduplicate only concurrent lookups. Completed results (including failures)
// must not survive tenant switches, pilot rollback or a new navigation intent.
export function createShellMigrationResolver(fetchMigration: (appCode: string, target: string) => Promise<{ migrated?: boolean, target?: string }>) {
  const pending = new Map<string, Promise<string>>()
  return (appCode: string, target: string) => {
    const key = JSON.stringify([appCode, target])
    const existing = pending.get(key)
    if (existing) return existing
    const request = Promise.resolve().then(() => fetchMigration(appCode, target)).then(result => {
      if (!result || typeof result.migrated !== 'boolean') throw Error('Invalid migration response')
      if (!result.migrated) return ''
      if (!result.target?.startsWith('/') || result.target.startsWith('//') || /[\\\u0000-\u0020]/.test(result.target)) throw Error('Invalid migration destination')
      return result.target
    }).finally(() => { if (pending.get(key) === request) pending.delete(key) })
    pending.set(key, request)
    return request
  }
}
