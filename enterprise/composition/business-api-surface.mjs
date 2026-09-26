import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The Host readiness boundary must never be a second, hand-maintained list of
// endpoints: it drifts silently behind the route tree and turns shipped pages
// into 503s while every source-text test still passes. The registered route
// files are the single technical fact source, and this module derives the
// reviewed METHOD + route surface from them at build time.
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace']

export const defaultRoutesDir = fileURLToPath(new URL('../server/routes', import.meta.url))

// Local operational probes are not business APIs: they answer 404 unless the
// hzy0 worker-health credential is present, and must never wait on readiness.
const OPERATIONAL_ROUTE_FILES = new Set(['enterprise/_hzy0_worker_health.get.ts'])

function walk(dir, base = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...walk(`${dir}/${entry.name}`, rel))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) found.push(rel)
  }
  return found
}

// Mirrors Nitro's file-based route conventions: a trailing `.<method>` segment
// binds the handler to that method, `index` collapses onto its directory,
// `[param]` becomes `:param` and `[...rest]` becomes a wildcard.
export function routeFromFile(relativePath) {
  let rest = relativePath.replace(/\.(?:ts|mjs|js)$/, '')
  let method = 'ALL'
  const suffix = rest.match(/\.([a-z]+)$/)
  if (suffix && METHODS.includes(suffix[1])) {
    method = suffix[1].toUpperCase()
    rest = rest.slice(0, -(suffix[1].length + 1))
  }
  rest = rest.replace(/\/index$/, '').replace(/^index$/, '')
  const route = '/' + rest.split('/').filter(Boolean).map((segment) => {
    const wildcard = segment.match(/^\[\.\.\.([^\]]*)\]$/)
    if (wildcard) return `**${wildcard[1] ? `:${wildcard[1]}` : ''}`
    const param = segment.match(/^\[([^\]]+)\]$/)
    return param ? `:${param[1]}` : segment
  }).join('/')
  return { method, route: route === '/' ? '/' : route.replace(/\/$/, '') }
}

export function deriveBusinessApiSurface(routesDir = defaultRoutesDir) {
  const prefixes = readdirSync(routesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  for (const prefix of prefixes) {
    if (!/^[a-z][a-z0-9-]*$/.test(prefix)) throw Error(`Invalid business route prefix: ${prefix}`)
  }
  const seen = new Set()
  const routes = []
  for (const file of walk(routesDir)) {
    if (OPERATIONAL_ROUTE_FILES.has(file)) continue
    const { method, route } = routeFromFile(file)
    const key = `${method} ${route}`
    if (seen.has(key)) throw Error(`Duplicate business API route: ${key}`)
    seen.add(key)
    routes.push({ method, route, file })
  }
  routes.sort((a, b) => (a.route === b.route ? a.method.localeCompare(b.method) : a.route.localeCompare(b.route)))
  return { prefixes, routes }
}
