// Console user APIs that another app's BFF may call on behalf of the signed-in
// user. The Host forwards only the verified user credential; Console still
// checks the user's own permission on every call. This list is the single
// source for both the Foundation helper and the local hzy0 Console egress, so
// adding a page means adding its exact routes here and nowhere else.
//
// Each entry: id, method, path template (`:name` matches one safe segment),
// the query keys the caller may pass, and whether it writes (writes require an
// Idempotency-Key from the browser request).

// Plain TypeScript with erasable types only: Nitro bundles it, and the hzy0
// egress (Node 24) loads it directly with type stripping.
export interface ConsoleUserApiRoute {
  readonly id: string
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly path: string
  readonly query: readonly string[]
  readonly write: boolean
}

export const consoleUserApiRoutes: readonly ConsoleUserApiRoute[] = Object.freeze([
  Object.freeze({ id: 'notifications.todos.list', method: 'GET', path: '/api/v1/console/notifications/todos', query: Object.freeze(['todoKind', 'cursor', 'limit']), write: false }),
  Object.freeze({ id: 'directory.users.list', method: 'GET', path: '/api/v1/console/directory/users', query: Object.freeze(['page', 'pageSize', 'search', 'deptCode', 'status']), write: false }),
  Object.freeze({ id: 'directory.users.read', method: 'GET', path: '/api/v1/console/directory/users/:uid', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'directory.departments.list', method: 'GET', path: '/api/v1/console/directory/departments', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'directory.departments.create', method: 'POST', path: '/api/v1/console/directory/departments', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.departments.update', method: 'PATCH', path: '/api/v1/console/directory/departments/:deptCode', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.departments.delete', method: 'DELETE', path: '/api/v1/console/directory/departments/:deptCode', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.departments.read', method: 'GET', path: '/api/v1/console/directory/departments/:deptCode', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'directory.projects.list', method: 'GET', path: '/api/v1/console/directory/projects', query: Object.freeze(['page', 'pageSize', 'search', 'deptCode', 'leaderUid', 'status']), write: false }),
  Object.freeze({ id: 'directory.projects.create', method: 'POST', path: '/api/v1/console/directory/projects', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.projects.update', method: 'PATCH', path: '/api/v1/console/directory/projects/:projectCode', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.projects.delete', method: 'DELETE', path: '/api/v1/console/directory/projects/:projectCode', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.projects.members.replace', method: 'POST', path: '/api/v1/console/directory/projects/members', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.projects.members.list', method: 'GET', path: '/api/v1/console/directory/projects/members', query: Object.freeze(['projectCode', 'page', 'pageSize', 'search', 'status']), write: false }),
  Object.freeze({ id: 'directory.projects.read', method: 'GET', path: '/api/v1/console/directory/projects/:projectCode', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'directory.committees.list', method: 'GET', path: '/api/v1/console/directory/committees', query: Object.freeze(['page', 'pageSize', 'search', 'status']), write: false }),
  Object.freeze({ id: 'directory.committees.create', method: 'POST', path: '/api/v1/console/directory/committees', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.committees.update', method: 'PATCH', path: '/api/v1/console/directory/committees/:committeeCode', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.committees.delete', method: 'DELETE', path: '/api/v1/console/directory/committees/:committeeCode', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.committees.members.save', method: 'POST', path: '/api/v1/console/directory/committees/:committeeCode/members', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.committees.members.update', method: 'PATCH', path: '/api/v1/console/directory/committees/:committeeCode/members/:uid', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.committees.members.remove', method: 'DELETE', path: '/api/v1/console/directory/committees/:committeeCode/members/:uid', query: Object.freeze([]), write: true }),
  Object.freeze({ id: 'directory.committees.members.list', method: 'GET', path: '/api/v1/console/directory/committees/:committeeCode/members', query: Object.freeze(['page', 'pageSize', 'search', 'role']), write: false }),
  Object.freeze({ id: 'work-calendars.list', method: 'GET', path: '/api/v1/console/work-calendars', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'work-calendars.months.list', method: 'GET', path: '/api/v1/console/work-calendars/:calendarCode/months', query: Object.freeze(['year']), write: false }),
  Object.freeze({ id: 'work-calendars.days.list', method: 'GET', path: '/api/v1/console/work-calendars/:calendarCode/days', query: Object.freeze(['yearMonth']), write: false }),
  Object.freeze({ id: 'directory.sync-jobs.list', method: 'GET', path: '/api/v1/console/directory/sync-jobs', query: Object.freeze(['limit', 'page', 'pageSize']), write: false }),
  Object.freeze({ id: 'directory.sync-jobs.read', method: 'GET', path: '/api/v1/console/directory/sync-jobs/:jobCode', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'directory.sync-jobs.events.list', method: 'GET', path: '/api/v1/console/directory/sync-jobs/:jobCode/events', query: Object.freeze(['limit', 'page', 'pageSize']), write: false }),
  Object.freeze({ id: 'organization.business-domains.list', method: 'GET', path: '/api/v1/companies/:companyCode/business-domains', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'organization.regions.list', method: 'GET', path: '/api/v1/companies/:companyCode/regions', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'organization.regions.divisions.list', method: 'GET', path: '/api/v1/companies/:companyCode/regions/:regionCode/divisions', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'runtime-summary.data.read', method: 'GET', path: '/api/v1/console/data-runtime/status', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'runtime-summary.applications.read', method: 'GET', path: '/api/v1/console/runtime/apps', query: Object.freeze([]), write: false }),
  Object.freeze({ id: 'org-profile.read', method: 'GET', path: '/api/v1/console/profile', query: Object.freeze([]), write: false })
])

const SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/

function matchTemplate(template: string, path: string): Record<string, string> | null {
  const expected = template.split('/')
  const actual = path.split('/')
  if (expected.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i]!
    const value = actual[i]!
    if (part.startsWith(':')) {
      if (!SEGMENT.test(value) || value === '.' || value === '..') return null
      // A static members path must not become a project item through another METHOD.
      if (template.startsWith('/api/v1/console/directory/projects/') && part === ':projectCode' && value === 'members') return null
      params[part.slice(1)] = value
    } else if (part !== value) {
      return null
    }
  }
  return params
}

/** Finds the registered route for an outgoing METHOD + path (no query string). */
export function matchConsoleUserApiRoute(method: string, path: string): ConsoleUserApiRoute | null {
  const upper = String(method || '').toUpperCase()
  return consoleUserApiRoutes.find(route => route.method === upper && matchTemplate(route.path, path) !== null) || null
}

/** Builds the concrete path for a route id, validating every parameter. */
export function resolveConsoleUserApiRoute(id: string, params: Record<string, string> = {}): { route: ConsoleUserApiRoute, path: string } {
  const route = consoleUserApiRoutes.find(item => item.id === id)
  if (!route) throw new Error(`Unregistered Console user API route: ${id}`)
  const used = new Set<string>()
  const path = route.path.split('/').map((part) => {
    if (!part.startsWith(':')) return part
    const name = part.slice(1)
    const value = params[name]
    if (typeof value !== 'string' || !SEGMENT.test(value) || value === '.' || value === '..') {
      throw new Error(`Invalid Console user API parameter: ${name}`)
    }
    used.add(name)
    return value
  }).join('/')
  if (!matchTemplate(route.path, path)) throw new Error('Invalid Console user API parameter')
  if (Object.keys(params).some(name => !used.has(name))) throw new Error('Unexpected Console user API parameter')
  return { route, path }
}
