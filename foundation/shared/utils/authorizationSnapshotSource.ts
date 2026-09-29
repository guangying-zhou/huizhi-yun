/**
 * Where the browser reads its personnel authorization snapshot, and how the
 * response is validated.
 *
 * A standalone business application owns exactly one application code and keeps
 * the historical root `GET /api/auth/permissions` contract.
 *
 * The composed Enterprise Host serves pages of several business modules whose
 * resource codes may collide (`products` exists in Aims and Assets), so it never
 * merges them into one flat map. Each Host page carries the owning module in
 * its build-time route meta (`authorizationApp`, derived from the composition
 * registry), and the snapshot is requested per module from
 * `GET /enterprise/api/auth/permissions?app=<module>`. A Host page without an
 * owning module has no module snapshot at all.
 *
 * A response that is not the expected JSON envelope (for example an SPA HTML
 * fallback for an unregistered path) is an error, never an empty snapshot.
 */
export const ENTERPRISE_AUTHORIZATION_PERMISSIONS_PATH = '/enterprise/api/auth/permissions'
export const AUTHORIZATION_SNAPSHOT_INVALID_RESPONSE = 'authorization_snapshot_invalid_response'

const applicationCodePattern = /^[a-z][a-z0-9-]{0,63}$/

export interface AuthorizationSnapshotSourceConfig {
  appCode?: unknown
  [key: string]: unknown
}

export interface AuthorizationSnapshotSource {
  /** Cache key of the per-module state; '' for a standalone application. */
  key: string
  url: string
  /** Module code the Host response must echo; null for a standalone application. */
  expectedApp: string | null
}

export function isEnterpriseHostAuthorization(config?: AuthorizationSnapshotSourceConfig | null) {
  return config?.appCode === 'enterprise'
}

/** Reads the owning module a Host route declared at build time; never user input. */
export function routeAuthorizationApp(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const value = (meta as Record<string, unknown>).authorizationApp
  return typeof value === 'string' && applicationCodePattern.test(value) ? value : null
}

/**
 * Standalone applications always use their own root endpoint. The Host uses the
 * per-module endpoint for the route's owning module, or no source at all.
 */
export function resolveAuthorizationSnapshotSource(
  config: AuthorizationSnapshotSourceConfig | null | undefined,
  routeMeta?: unknown
): AuthorizationSnapshotSource | null {
  if (!isEnterpriseHostAuthorization(config)) {
    return { key: '', url: '/api/auth/permissions', expectedApp: null }
  }
  const app = routeAuthorizationApp(routeMeta)
  if (!app) return null
  return {
    key: app,
    url: `${ENTERPRISE_AUTHORIZATION_PERMISSIONS_PATH}?app=${encodeURIComponent(app)}`,
    expectedApp: app
  }
}

export interface AuthorizationSnapshotRoleOption {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  sources?: string[]
}

export interface ParsedAuthorizationSnapshot {
  uid: string
  roles: string[]
  availableRoles: AuthorizationSnapshotRoleOption[]
  activeRoleCode: string
  resources: Record<string, string[]>
  actionPolicies: Record<string, { implications: Record<string, string[]> }>
}

export class AuthorizationSnapshotResponseError extends Error {
  readonly code = AUTHORIZATION_SNAPSHOT_INVALID_RESPONSE
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationSnapshotResponseError'
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean) : []
}

function isEnterpriseRoleOption(role: AuthorizationSnapshotRoleOption) {
  const roleCode = role.roleCode
  if (!roleCode || roleCode.includes(':') || roleCode.includes('.')) return false
  return !String(role.appCode || '').trim()
}

/**
 * Validates the `{ code: 0, data: { resources, ... } }` envelope and normalizes
 * it. Throws AuthorizationSnapshotResponseError for anything else, including an
 * HTML string, a non-zero code, missing/invalid resources, or (for the Host) a
 * response for a different module than the one requested.
 */
export function parseAuthorizationSnapshotResponse(response: unknown, expectedApp: string | null): ParsedAuthorizationSnapshot {
  if (!plainObject(response)) {
    throw new AuthorizationSnapshotResponseError('Authorization snapshot response is not a JSON object')
  }
  if (response.code !== 0) {
    throw new AuthorizationSnapshotResponseError('Authorization snapshot response code is not 0')
  }
  const data = response.data
  if (!plainObject(data) || !plainObject(data.resources)) {
    throw new AuthorizationSnapshotResponseError('Authorization snapshot response has no resources map')
  }
  const resources: Record<string, string[]> = {}
  for (const [resource, actions] of Object.entries(data.resources)) {
    if (!Array.isArray(actions)) {
      throw new AuthorizationSnapshotResponseError('Authorization snapshot resource actions must be arrays')
    }
    resources[resource] = stringList(actions)
  }
  if (expectedApp !== null && data.appCode !== expectedApp) {
    throw new AuthorizationSnapshotResponseError('Authorization snapshot belongs to a different module')
  }
  if (data.actionPolicies !== undefined && data.actionPolicies !== null && !plainObject(data.actionPolicies)) {
    throw new AuthorizationSnapshotResponseError('Authorization snapshot action policies must be an object')
  }

  const availableRoles = (Array.isArray(data.availableRoles) ? data.availableRoles : [])
    .filter(plainObject)
    .map(role => ({
      roleCode: String(role.roleCode || '').trim(),
      roleName: String(role.roleName || role.roleCode || '').trim(),
      roleType: String(role.roleType || '').trim(),
      appCode: role.appCode ? String(role.appCode).trim() : null,
      sources: stringList(role.sources)
    }))
    .filter(isEnterpriseRoleOption)
  const roles = stringList(data.roles)
  const responseActive = String(data.activeRoleCode || roles[0] || '').trim()
  const activeRoleCode = availableRoles.some(role => role.roleCode === responseActive)
    ? responseActive
    : availableRoles[0]?.roleCode || ''

  return {
    uid: String(data.uid || ''),
    roles,
    availableRoles,
    activeRoleCode,
    resources,
    actionPolicies: (data.actionPolicies || {}) as ParsedAuthorizationSnapshot['actionPolicies']
  }
}
