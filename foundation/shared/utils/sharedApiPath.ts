/**
 * Foundation browser code addresses its shared user APIs (directory lookups,
 * notifications, the application catalog, the Workflow proxy) at the root
 * `/api/<operation>` contract. A composed Enterprise Host sits behind a tenant
 * gateway that sends root `/api/*` to Console, and Console does not recognise
 * the Host's per-application session. The Host therefore serves the same
 * operations under its own reserved base, configured at build time.
 *
 * Only this exact Host base is accepted, and only for appCode `enterprise`;
 * every other application or value keeps the root contract, so a mistaken
 * setting can never point a browser at an arbitrary origin or path.
 */
export const ENTERPRISE_SHARED_API_BASE = '/enterprise/api/foundation'

export interface SharedApiPathConfig {
  appCode?: unknown
  sharedApiBase?: unknown
}

export function resolveSharedApiBase(config?: SharedApiPathConfig | null) {
  return config?.appCode === 'enterprise' && config.sharedApiBase === ENTERPRISE_SHARED_API_BASE
    ? ENTERPRISE_SHARED_API_BASE
    : '/api'
}

/** Maps a root `/api/<operation>` path onto the application's shared API base. */
export function resolveSharedApiPath(path: string, config?: SharedApiPathConfig | null) {
  if (typeof path !== 'string' || (path !== '/api' && !path.startsWith('/api/'))) {
    throw new Error('Shared API path must start with /api/')
  }
  return `${resolveSharedApiBase(config)}${path.slice('/api'.length)}`
}
