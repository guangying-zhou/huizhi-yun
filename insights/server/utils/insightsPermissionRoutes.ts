export interface InsightsPermissionRule {
  resource: string
  action: string
}

interface CookieEvent {
  node?: {
    req?: {
      headers?: Record<string, string | string[] | undefined>
    }
  }
}

const ROLE_HR = 4
const ROLE_SUPERVISOR = 8
const ROLE_ADMIN = 16

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const publicAuthRequests: Record<string, Set<string>> = {
  'auth/check-email': new Set(['POST']),
  'auth/login': new Set(['POST']),
  'auth/send-code': new Set(['POST']),
  'auth/verify-code': new Set(['POST']),
  'auth/reset-password': new Set(['POST']),
  'auth/set-password': new Set(['POST']),
  'auth/platform-login': new Set(['POST']),
  'cas/validate': new Set(['GET'])
}

const publicAuthPaths = new Set(Object.keys(publicAuthRequests))

function normalizePath(path: string) {
  return String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^api\/+/, '')
}

function isExportPath(path: string) {
  return /(^|\/)(export|download|csv|xlsx)(\/|$)/.test(path)
    || /\.(csv|xlsx)$/.test(path)
}

export function isPublicInsightsPythonApiPath(path: string) {
  return publicAuthPaths.has(normalizePath(path))
}

export function isPublicInsightsPythonApiRequest(path: string, method: string) {
  const methods = publicAuthRequests[normalizePath(path)]
  return Boolean(methods?.has(String(method || 'GET').toUpperCase()))
}

function isSelfProfilePath(path: string, method: string) {
  if (path === 'profile') return method === 'GET' || method === 'PATCH'
  if (path === 'profile/password') return method === 'POST'
  return false
}

export function resolveInsightsPythonApiPermission(path: string, method: string): InsightsPermissionRule | null {
  const normalizedPath = normalizePath(path)
  const normalizedMethod = String(method || 'GET').toUpperCase()

  if (isPublicInsightsPythonApiRequest(normalizedPath, normalizedMethod)) return null

  if (/^(auth|cas)(\/|$)/.test(normalizedPath)) {
    return { resource: 'insights_settings', action: 'admin' }
  }

  if (isExportPath(normalizedPath)) {
    return { resource: 'dashboard', action: 'export' }
  }

  if (/^system(\/|$)/.test(normalizedPath)) {
    return { resource: 'insights_settings', action: 'admin' }
  }

  if (/^settings\/(repo-sources|sync-schedule)(\/|$)/.test(normalizedPath)) {
    return { resource: 'repo_ingestion', action: 'admin' }
  }

  if (normalizedPath === 'settings/monitoring') {
    return { resource: 'monitoring', action: 'admin' }
  }

  if (/^settings\//.test(normalizedPath)) {
    return { resource: 'insights_settings', action: 'admin' }
  }

  if (normalizedPath === 'statistics/aggregate') {
    return { resource: 'repo_ingestion', action: 'trigger' }
  }

  if (/^ingestion\//.test(normalizedPath)) {
    return {
      resource: 'repo_ingestion',
      action: mutatingMethods.has(normalizedMethod) ? 'trigger' : 'view'
    }
  }

  if (/^monitoring\/(start-date|event-levels|event-types)(\/|$)/.test(normalizedPath)) {
    return { resource: 'monitoring', action: 'admin' }
  }

  if (/^monitoring\/events(\/|$)/.test(normalizedPath)) {
    return {
      resource: 'monitoring',
      action: mutatingMethods.has(normalizedMethod) ? 'edit' : 'view'
    }
  }

  if (!mutatingMethods.has(normalizedMethod)) {
    if (normalizedPath === 'repos/sync-status') {
      return { resource: 'repo_ingestion', action: 'view' }
    }
    if (/^repos(\/|$)/.test(normalizedPath)) {
      return { resource: 'repos', action: 'view' }
    }
    if (/^contributors(\/|$)/.test(normalizedPath)) {
      return { resource: 'contributors', action: 'view' }
    }
    if (/^departments(\/|$)/.test(normalizedPath)) {
      return { resource: 'departments', action: 'view' }
    }
    if (/^commits(\/|$)/.test(normalizedPath)) {
      return { resource: 'commits', action: 'view' }
    }
    if (/^(dashboard|reports|statistics)(\/|$)/.test(normalizedPath)) {
      return { resource: 'dashboard', action: 'view' }
    }
  }

  // Users may maintain their own profile/password after authentication.
  if (isSelfProfilePath(normalizedPath, normalizedMethod)) return null

  if (!mutatingMethods.has(normalizedMethod)) {
    return { resource: 'insights_settings', action: 'admin' }
  }
  if (!normalizedPath) return { resource: 'insights_settings', action: 'admin' }

  if (/^repos\/[^/]+\/(active|department)$/.test(normalizedPath)) {
    return { resource: 'repos', action: 'admin' }
  }

  if (/^contributors(\/|$)/.test(normalizedPath) || normalizedPath === 'persons') {
    return { resource: 'contributors', action: 'edit' }
  }

  if (/^departments(\/|$)/.test(normalizedPath)) {
    return { resource: 'insights_settings', action: 'admin' }
  }

  if (normalizedPath === 'monitoring/scan') {
    return { resource: 'monitoring', action: 'admin' }
  }

  return { resource: 'insights_settings', action: 'admin' }
}

export function resolveInsightsSyncApiPermission(path: string, method: string): InsightsPermissionRule | null {
  const normalizedPath = normalizePath(path)
  const normalizedMethod = String(method || 'GET').toUpperCase()

  if (normalizedMethod !== 'POST') return null
  if (normalizedPath === 'departments' || normalizedPath === 'contributors') {
    return { resource: 'insights_settings', action: 'admin' }
  }

  return { resource: 'insights_settings', action: 'admin' }
}

function cookieValue(event: CookieEvent, name: string) {
  const header = event.node?.req?.headers?.cookie
  const cookieHeader = Array.isArray(header) ? header.join('; ') : String(header || '')
  const encodedName = `${encodeURIComponent(name)}=`

  for (const part of cookieHeader.split(';')) {
    const item = part.trim()
    if (!item.startsWith(encodedName)) continue
    return decodeURIComponent(item.slice(encodedName.length))
  }

  return ''
}

function httpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number, statusMessage: string }
  error.statusCode = statusCode
  error.statusMessage = message
  return error
}

export function getInsightsLegacyRoleMask(event: CookieEvent) {
  const parsed = Number(cookieValue(event, 'auth_role') || '0')
  return Number.isFinite(parsed) ? parsed : 0
}

function allowedRoleMask(rule: InsightsPermissionRule) {
  if (rule.action === 'admin' || rule.action === 'trigger') return ROLE_ADMIN
  if (rule.resource === 'contributors' && rule.action === 'edit') return ROLE_ADMIN | ROLE_SUPERVISOR | ROLE_HR
  if (rule.resource === 'monitoring' && rule.action === 'edit') return ROLE_ADMIN | ROLE_SUPERVISOR
  return ROLE_ADMIN
}

export function requireInsightsAuthenticated(event: CookieEvent) {
  const token = String(cookieValue(event, 'token') || '').trim()
  if (!token) {
    throw httpError(401, 'Unauthorized')
  }
}

export function requireInsightsApiPermission(event: CookieEvent, rule: InsightsPermissionRule | null) {
  requireInsightsAuthenticated(event)
  if (!rule) return
  if (rule.action === 'view') return

  const roleMask = getInsightsLegacyRoleMask(event)
  if ((roleMask & allowedRoleMask(rule)) === 0) {
    throw httpError(403, `Forbidden: missing insights:${rule.resource}:${rule.action}`)
  }
}
