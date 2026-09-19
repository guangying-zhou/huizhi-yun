import { businessApiPrefixes, businessApiRoutes } from './business-api-routes.generated.mjs'

// Readiness answers one question only: is this METHOD + path a registered Host
// handler? Person-level business authorization stays inside the handler, and a
// ready endpoint may still legitimately answer 403.
const escape = segment => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function toPattern(route) {
  const body = route.split('/').filter(Boolean).map((segment) => {
    if (segment.startsWith('**')) return '.*'
    if (segment.startsWith(':')) return '[^/]+'
    return escape(segment)
  }).join('/')
  return body ? `/${body}` : '/'
}

// One alternation per method keeps the per-request cost a single regex test.
const matchers = new Map()
for (const [method, route] of businessApiRoutes) {
  const patterns = matchers.get(method) || []
  patterns.push(toPattern(route))
  matchers.set(method, patterns)
}
for (const [method, patterns] of matchers) {
  matchers.set(method, new RegExp(`^(?:${patterns.join('|')})$`))
}

const fence = new RegExp(`^/(?:${businessApiPrefixes.map(escape).join('|')})/api(?:/|$)`)

/** True when the path sits behind the Host business-API readiness boundary. */
export function isBusinessApiPath(path) {
  return fence.test(path)
}

/** True when a Host handler is registered for this exact METHOD and path. */
export function isBusinessApiReady(method, path) {
  const exact = matchers.get(method)
  if (exact && exact.test(path)) return true
  const any = matchers.get('ALL')
  return Boolean(any && any.test(path))
}
