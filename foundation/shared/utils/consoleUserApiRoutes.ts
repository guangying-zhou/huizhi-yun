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
  Object.freeze({ id: 'notifications.todos.list', method: 'GET', path: '/api/v1/console/notifications/todos', query: Object.freeze(['todoKind', 'cursor', 'limit']), write: false })
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
