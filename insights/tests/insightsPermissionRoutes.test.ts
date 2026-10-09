import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import {
  isPublicInsightsPythonApiRequest,
  isPublicInsightsPythonApiPath,
  requireInsightsApiPermission,
  resolveInsightsPythonApiPermission,
  resolveInsightsSyncApiPermission,
  type InsightsPermissionRule
} from '../server/utils/insightsPermissionRoutes'

type PermissionEvent = Parameters<typeof requireInsightsApiPermission>[0]
type HttpError = Error & { statusCode?: number }

function eventWithCookie(cookie: string) {
  return {
    node: {
      req: {
        headers: { cookie },
        method: 'POST'
      }
    }
  } satisfies PermissionEvent
}

function expectForbidden(cookie: string, rule: InsightsPermissionRule) {
  try {
    requireInsightsApiPermission(eventWithCookie(cookie), rule)
    throw new Error('expected forbidden')
  } catch (error: unknown) {
    expect((error as HttpError).statusCode).toBe(403)
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function expectBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  expect(leftIndex, `missing ${left}`).toBeGreaterThanOrEqual(0)
  expect(rightIndex, `missing ${right}`).toBeGreaterThanOrEqual(0)
  expect(leftIndex, `${left} must appear before ${right}`).toBeLessThan(rightIndex)
}

function pythonRouterMethods(path: string, prefix: string) {
  const content = source(path)
  return Array.from(content.matchAll(/@router\.(get|post|put|patch|delete)\("([^"]+)"/g))
    .map((match) => {
      const suffix = String(match[2] || '').replace(/^\/+|\/+$/g, '')
      return {
        method: String(match[1] || '').toUpperCase(),
        path: suffix ? `${prefix}/${suffix}` : prefix
      }
    })
    .sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))
}

function normalizePythonApiPath(path: string) {
  return String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^api\/+/, '')
}

function pythonApiRoutes() {
  const apiDir = new URL('../backend/server/python_service/api/', import.meta.url)
  const routes = new Map<string, { method: string, path: string }>()

  for (const entry of readdirSync(apiDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.py') || entry.name === '__init__.py') continue

    const content = readFileSync(new URL(entry.name, apiDir), 'utf8')
    const prefixes = new Map<string, string>()
    for (const match of content.matchAll(/(\w+)\s*=\s*APIRouter\(prefix="([^"]+)"/g)) {
      prefixes.set(String(match[1] || ''), normalizePythonApiPath(String(match[2] || '')))
    }

    for (const match of content.matchAll(/@(\w+)\.(get|post|put|patch|delete)\("([^"]*)"/g)) {
      const prefix = prefixes.get(String(match[1] || ''))
      if (!prefix) continue
      const suffix = normalizePythonApiPath(String(match[3] || ''))
      const path = suffix ? `${prefix}/${suffix}` : prefix
      const method = String(match[2] || '').toUpperCase()
      routes.set(`${method} ${path}`, { method, path })
    }
  }

  return Array.from(routes.values())
    .sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))
}

function accountSyncApiHandlers() {
  const syncDir = new URL('../server/api/sync/', import.meta.url)
  return readdirSync(syncDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.post.ts'))
    .map(entry => ({
      path: `server/api/sync/${entry.name}`,
      syncPath: entry.name.replace(/\.post\.ts$/, '')
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function manifestResourceActions() {
  const manifest = JSON.parse(source('app.manifest.json')) as {
    resources: Array<{ code: string, actions: string[] }>
  }
  return new Map(manifest.resources.map(resource => [resource.code, new Set(resource.actions)]))
}

describe('Insights BFF permission route mapping', () => {
  it('does not maintain a module-owned notification API or notification center', () => {
    expect(existsSync(new URL('../server/api/notifications.ts', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../app/components/NotificationsSlideover.vue', import.meta.url))).toBe(false)
  })

  it('maps ingestion and aggregate jobs to explicit trigger permission', () => {
    expect(resolveInsightsPythonApiPermission('ingestion/repos/scan', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'trigger'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/files/start', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'trigger'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/files/stop', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'trigger'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/sync/gitlab', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'trigger'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/sync/svn', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'trigger'
    })
    expect(resolveInsightsPythonApiPermission('statistics/aggregate', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'trigger'
    })
  })

  it('keeps ingestion status and logs behind ingestion view instead of generic read-only access', () => {
    expect(resolveInsightsPythonApiPermission('ingestion/files/status', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/files/logs', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/runs', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/runs/7/logs', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('ingestion/daily/status', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'view'
    })
  })

  it('maps repository source and ingestion schedule maintenance to ingestion admin', () => {
    expect(resolveInsightsPythonApiPermission('settings/repo-sources', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/repo-sources/7', 'DELETE')).toEqual({
      resource: 'repo_ingestion',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/sync-schedule', 'POST')).toEqual({
      resource: 'repo_ingestion',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/repo-sources/7', 'PUT')).toEqual({
      resource: 'repo_ingestion',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('repos/42/active', 'PUT')).toEqual({
      resource: 'repos',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('repos/42/department', 'PUT')).toEqual({
      resource: 'repos',
      action: 'admin'
    })
  })

  it('maps global settings and Account sync writes to Insights settings admin', () => {
    expect(resolveInsightsPythonApiPermission('settings/params', 'PUT')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/users/7', 'PUT')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('departments/7', 'PATCH')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsSyncApiPermission('departments', 'POST')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsSyncApiPermission('contributors', 'POST')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
  })

  it('keeps system proxy reads behind settings admin instead of generic read-only access', () => {
    expect(resolveInsightsPythonApiPermission('system/users/by-email', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('system/ingestion_completed', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
  })

  it('keeps settings proxy reads behind their admin resources', () => {
    expect(resolveInsightsPythonApiPermission('settings/params', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/users', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/repo-sources', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/sync-schedule', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/monitoring', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
  })

  it('keeps monitoring rule configuration reads behind monitoring admin', () => {
    expect(resolveInsightsPythonApiPermission('monitoring/start-date', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/event-levels', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/event-types', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
  })

  it('keeps monitoring event reads behind monitoring view and writes behind edit', () => {
    expect(resolveInsightsPythonApiPermission('monitoring/events', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/events/stats', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/events/42', 'GET')).toEqual({
      resource: 'monitoring',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/events/42', 'PUT')).toEqual({
      resource: 'monitoring',
      action: 'edit'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/events/42', 'DELETE')).toEqual({
      resource: 'monitoring',
      action: 'edit'
    })
  })

  it('maps monitoring and contributor writes to their manifest resources', () => {
    expect(resolveInsightsPythonApiPermission('monitoring/scan', 'POST')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('settings/monitoring', 'PUT')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/event-types/2', 'DELETE')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/event-levels/2', 'PUT')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/start-date', 'POST')).toEqual({
      resource: 'monitoring',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('monitoring/events/42', 'PUT')).toEqual({
      resource: 'monitoring',
      action: 'edit'
    })
    expect(resolveInsightsPythonApiPermission('contributors/7', 'PATCH')).toEqual({
      resource: 'contributors',
      action: 'edit'
    })
  })

  it('maps core read-only business proxy paths to manifest view resources', () => {
    expect(resolveInsightsPythonApiPermission('repos', 'GET')).toEqual({
      resource: 'repos',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('repos/42', 'GET')).toEqual({
      resource: 'repos',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('repos/42/stats/daily', 'GET')).toEqual({
      resource: 'repos',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('repos/sync-status', 'GET')).toEqual({
      resource: 'repo_ingestion',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('contributors', 'GET')).toEqual({
      resource: 'contributors',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('contributors/7/commits', 'GET')).toEqual({
      resource: 'contributors',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('departments', 'GET')).toEqual({
      resource: 'departments',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('commits/abc123', 'GET')).toEqual({
      resource: 'commits',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('dashboard/repos/stats', 'GET')).toEqual({
      resource: 'dashboard',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('reports/commits', 'GET')).toEqual({
      resource: 'dashboard',
      action: 'view'
    })
    expect(resolveInsightsPythonApiPermission('statistics/overview', 'GET')).toEqual({
      resource: 'dashboard',
      action: 'view'
    })
  })

  it('keeps self-profile requests out of extra permission checks', () => {
    expect(resolveInsightsPythonApiPermission('profile', 'GET')).toBeNull()
    expect(resolveInsightsPythonApiPermission('profile', 'PATCH')).toBeNull()
    expect(resolveInsightsPythonApiPermission('profile/password', 'POST')).toBeNull()
    expect(resolveInsightsPythonApiPermission('profile/sessions', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('profile/avatar', 'PATCH')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('profile/password', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
  })

  it('fails closed for unknown read-only proxy paths', () => {
    expect(resolveInsightsPythonApiPermission('internal/debug', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('unknown/report', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
  })

  it('identifies public auth proxy routes separately from authenticated read-only routes', () => {
    expect(isPublicInsightsPythonApiPath('auth/login')).toBe(true)
    expect(isPublicInsightsPythonApiPath('auth/check-email')).toBe(true)
    expect(isPublicInsightsPythonApiPath('auth/platform-login')).toBe(true)
    expect(isPublicInsightsPythonApiPath('cas/validate')).toBe(true)
    expect(isPublicInsightsPythonApiPath('auth/users')).toBe(false)
    expect(isPublicInsightsPythonApiPath('cas/sessions')).toBe(false)
    expect(isPublicInsightsPythonApiPath('dashboard/repos/stats')).toBe(false)
    expect(isPublicInsightsPythonApiPath('profile')).toBe(false)
  })

  it('only treats public auth proxy routes as public for their declared methods', () => {
    expect(isPublicInsightsPythonApiRequest('auth/login', 'POST')).toBe(true)
    expect(isPublicInsightsPythonApiRequest('auth/check-email', 'POST')).toBe(true)
    expect(isPublicInsightsPythonApiRequest('auth/platform-login', 'POST')).toBe(true)
    expect(isPublicInsightsPythonApiRequest('cas/validate', 'GET')).toBe(true)
    expect(isPublicInsightsPythonApiRequest('auth/login', 'GET')).toBe(false)
    expect(isPublicInsightsPythonApiRequest('auth/check-email', 'GET')).toBe(false)
    expect(isPublicInsightsPythonApiRequest('cas/validate', 'POST')).toBe(false)
    expect(isPublicInsightsPythonApiRequest('auth/users', 'POST')).toBe(false)
  })

  it('keeps the BFF public auth whitelist aligned with Python auth routes', () => {
    const authRoutes = [
      ...pythonRouterMethods('backend/server/python_service/api/auth.py', 'auth'),
      ...pythonRouterMethods('backend/server/python_service/api/cas.py', 'cas')
    ].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))

    expect(authRoutes).toEqual([
      { method: 'GET', path: 'cas/validate' },
      { method: 'POST', path: 'auth/check-email' },
      { method: 'POST', path: 'auth/login' },
      { method: 'POST', path: 'auth/platform-login' },
      { method: 'POST', path: 'auth/reset-password' },
      { method: 'POST', path: 'auth/send-code' },
      { method: 'POST', path: 'auth/set-password' },
      { method: 'POST', path: 'auth/verify-code' }
    ])

    for (const route of authRoutes) {
      expect(isPublicInsightsPythonApiRequest(route.path, route.method)).toBe(true)
    }
  })

  it('keeps unknown auth and cas proxy paths behind settings admin', () => {
    expect(resolveInsightsPythonApiPermission('auth/users', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('auth/users', 'POST')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('cas/sessions', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('auth/login', 'POST')).toBeNull()
    expect(resolveInsightsPythonApiPermission('cas/validate', 'GET')).toBeNull()
    expect(resolveInsightsPythonApiPermission('auth/login', 'GET')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
    expect(resolveInsightsPythonApiPermission('cas/validate', 'POST')).toEqual({
      resource: 'insights_settings',
      action: 'admin'
    })
  })

  it('maps every Python API route to a manifest permission or explicit authenticated self-service exception', () => {
    const resources = manifestResourceActions()
    const authenticatedSelfService = new Set([
      'GET profile',
      'PATCH profile',
      'POST profile/password'
    ])

    for (const route of pythonApiRoutes()) {
      const routeKey = `${route.method} ${route.path}`
      const rule = resolveInsightsPythonApiPermission(route.path, route.method)

      if (isPublicInsightsPythonApiRequest(route.path, route.method) || authenticatedSelfService.has(routeKey)) {
        expect(rule, routeKey).toBeNull()
        continue
      }

      expect(rule, routeKey).not.toBeNull()
      const actions = resources.get(rule!.resource)
      expect(actions, `${routeKey} resource ${rule!.resource}`).toBeDefined()
      expect(actions!.has(rule!.action), `${routeKey} action ${rule!.resource}:${rule!.action}`).toBe(true)
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) {
        expect(rule!.action, `${routeKey} must not be mapped to view`).not.toBe('view')
      }
    }
  })

  it('maps GET export-style endpoints to dashboard export permission', () => {
    expect(resolveInsightsPythonApiPermission('reports/contributors/export', 'GET')).toEqual({
      resource: 'dashboard',
      action: 'export'
    })
    expect(resolveInsightsPythonApiPermission('dashboard/repos/download', 'GET')).toEqual({
      resource: 'dashboard',
      action: 'export'
    })
    expect(resolveInsightsPythonApiPermission('reports/repos.csv', 'GET')).toEqual({
      resource: 'dashboard',
      action: 'export'
    })
    expect(resolveInsightsPythonApiPermission('reports/repos/xlsx', 'POST')).toEqual({
      resource: 'dashboard',
      action: 'export'
    })
  })

  it('guards proxy and Account sync handlers before forwarding side effects', () => {
    const pythonProxy = source('server/api/python/[...path].ts')

    expectBefore(pythonProxy, 'isPublicInsightsPythonApiRequest(path, method)', 'requireInsightsApiPermission')
    expectBefore(pythonProxy, 'requireInsightsApiPermission', 'proxyRequest(event, targetUrl)')

    const syncHandlers = accountSyncApiHandlers()
    expect(syncHandlers.map(handler => handler.syncPath)).toEqual(['contributors', 'departments'])

    for (const handler of syncHandlers) {
      const content = source(handler.path)
      expectBefore(content, 'requireInsightsApiPermission', 'const config = useRuntimeConfig()')
      expectBefore(content, 'requireInsightsApiPermission', '$fetch')
      expectBefore(content, 'requireInsightsApiPermission', 'execute(')
      expect(content).toContain(`resolveInsightsSyncApiPermission('${handler.syncPath}'`)
    }
  })
})

describe('Insights legacy role enforcement', () => {
  it('requires admin role for trigger/admin permissions', () => {
    const rule = { resource: 'repo_ingestion', action: 'trigger' }
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t; auth_role=16'), rule)).not.toThrow()
    expectForbidden('token=t; auth_role=1', rule)
  })

  it('allows HR or supervisor to edit contributor mapping but not trigger jobs', () => {
    const contributorEdit = { resource: 'contributors', action: 'edit' }
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t; auth_role=4'), contributorEdit)).not.toThrow()
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t; auth_role=8'), contributorEdit)).not.toThrow()
    expectForbidden('token=t; auth_role=4', { resource: 'repo_ingestion', action: 'trigger' })
  })

  it('requires admin role for dashboard export permissions', () => {
    const rule = { resource: 'dashboard', action: 'export' }
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t; auth_role=16'), rule)).not.toThrow()
    expectForbidden('token=t; auth_role=4', rule)
    expectForbidden('token=t; auth_role=8', rule)
  })

  it('keeps manifest view rules compatible with any authenticated legacy user', () => {
    const rule = { resource: 'dashboard', action: 'view' }
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t'), rule)).not.toThrow()
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t; auth_role=0'), rule)).not.toThrow()
    expect(() => requireInsightsApiPermission(eventWithCookie('token=t; auth_role=4'), rule)).not.toThrow()
  })

  it('requires an authenticated token cookie before checking permissions', () => {
    try {
      requireInsightsApiPermission(eventWithCookie('auth_role=16'), { resource: 'insights_settings', action: 'admin' })
      throw new Error('expected unauthorized')
    } catch (error: unknown) {
      expect((error as HttpError).statusCode).toBe(401)
    }
  })

  it('still requires authentication for read-only routes without extra permission checks', () => {
    try {
      requireInsightsApiPermission(eventWithCookie('auth_role=16'), null)
      throw new Error('expected unauthorized')
    } catch (error: unknown) {
      expect((error as HttpError).statusCode).toBe(401)
    }
  })
})
