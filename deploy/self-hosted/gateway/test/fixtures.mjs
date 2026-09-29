// Disposable fixtures only: loopback servers, a mocked Platform origin and
// per-run random secrets. No network, database or real credential is used.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { validateConfig } from '../config.mjs'
import { createGatewayHost } from '../server.mjs'

export const PLATFORM_ORIGIN = 'https://platform.selfhosted-fixture.test'
export const RUNTIME_ENDPOINT = 'https://runtime.selfhosted-fixture.test'
let siteCounter = 0

export function randomSecret() {
  return randomBytes(24).toString('base64url')
}

/** Raw config object (as it would appear in the JSON file). */
export function rawConfig({ publicHost, apps, overrides = {} } = {}) {
  siteCounter += 1
  return {
    schemaVersion: 1,
    site: {
      publicHost: publicHost || `site-${process.pid}-${siteCounter}.selfhosted-fixture.test`,
      tenantCode: 'T900001',
      environment: 'selfhosted',
      tenantDomainSuffix: 'selfhosted-fixture.test'
    },
    platform: { origin: PLATFORM_ORIGIN },
    runtime: { endpoint: RUNTIME_ENDPOINT, runtimeCode: 't900001-selfhosted-runtime' },
    apps: apps || {
      console: { origin: 'http://127.0.0.1:1', deploymentCode: 'T900001-sh-console' }
    },
    listeners: { ingress: { host: '127.0.0.1', port: 18780 }, health: { host: '127.0.0.1', port: 18781 } },
    scheduler: { drain: { enabled: true, apps: ['console'] }, policySync: { enabled: true } },
    secrets: { gatewayInternalToken: randomSecret(), platformRegistryToken: randomSecret() },
    ...overrides
  }
}

/** Loopback upstream that records requests and answers with `respond`. */
export async function startUpstream(name, respond = defaultRespond) {
  const calls = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const call = { name, method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
    calls.push(call)
    await respond(call, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { name, origin, calls, server, close: () => new Promise(resolve => server.close(resolve)) }
}

function defaultRespond(call, res) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ app: call.name, path: call.url }))
}

export function registryRecord(config, overrides = {}) {
  const apps = {}
  for (const [appCode, app] of Object.entries(config.apps)) {
    if (app.deploymentCode) apps[appCode] = { deploymentCode: app.deploymentCode, basePath: appCode === 'console' ? '/' : `/${appCode}` }
  }
  return {
    host: config.site.publicHost,
    tenantCode: config.site.tenantCode,
    environment: config.site.environment,
    deploymentCode: config.apps.console.deploymentCode,
    apps,
    dataRuntime: { endpoint: config.runtime.endpoint, runtimeCode: config.runtime.runtimeCode },
    login: {},
    ...overrides
  }
}

/**
 * Mocked Platform for the configured HTTPS origin; loopback calls go to the
 * real fetch so the fixture upstreams receive them.
 */
export function platformMock(config, { record = () => registryRecord(config), calls = [] } = {}) {
  const nativeFetch = globalThis.__nativeFetch || globalThis.fetch
  globalThis.__nativeFetch = nativeFetch
  const baseFetch = async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.origin !== PLATFORM_ORIGIN) return await nativeFetch(input, init)
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: new Headers(init.headers) })
    if (url.pathname.endsWith('/resolve')) {
      const value = record(url.searchParams.get('host'))
      return value ? Response.json({ data: value }) : new Response('not found', { status: 404 })
    }
    if (url.pathname.endsWith('/runtime-bootstrap-token')) {
      return Response.json({ data: { token: `fixture-bootstrap-${randomSecret()}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } })
    }
    return new Response('unexpected', { status: 500 })
  }
  return { baseFetch, calls }
}

/**
 * Build a gateway host bound to ephemeral loopback ports. The Worker's
 * non-binding `fetch` calls are routed through the host egress for the
 * duration of the test (as `main()` does in production).
 */
export async function startGateway(config, { record, platformCalls, log = () => {}, ...options } = {}) {
  const { baseFetch, calls } = platformMock(config, { record, calls: platformCalls })
  const host = createGatewayHost(config, { baseFetch, log, ...options })
  const previousFetch = globalThis.fetch
  globalThis.fetch = host.egressFetch
  await new Promise(resolve => host.ingress.listen(0, config.listeners.ingress.host, resolve))
  await new Promise(resolve => host.health.listen(0, config.listeners.health.host, resolve))
  const port = host.ingress.address().port
  return {
    ...host,
    platformCalls: calls,
    port,
    healthPort: host.health.address().port,
    request(path, init = {}) {
      const headers = new Headers(init.headers)
      if (!headers.has('host')) headers.set('host', config.site.publicHost)
      return rawRequest(port, path, { ...init, headers })
    },
    async close() {
      await host.scheduler.stop()
      host.ingress.closeAllConnections?.()
      await new Promise(resolve => host.ingress.close(resolve))
      await new Promise(resolve => host.health.close(resolve))
      globalThis.fetch = previousFetch
    }
  }
}

/** Plain node:http client so the Host header and x-hzy-* headers are sent verbatim. */
export function rawRequest(port, path, { method = 'GET', headers = new Headers(), body } = {}) {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers: Object.fromEntries(headers) }, (res) => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      req.on('error', reject)
      if (body !== undefined) req.write(body)
      req.end()
    }, reject)
  })
}

export function configFor(upstreams, { overrides = {}, publicHost, enterprise } = {}) {
  const apps = {}
  for (const upstream of upstreams) {
    apps[upstream.name] = upstream.name === 'collab'
      ? { origin: upstream.origin }
      : { origin: upstream.origin, deploymentCode: `T900001-sh-${upstream.name}` }
  }
  const raw = rawConfig({ publicHost, apps })
  if (enterprise) raw.enterprise = enterprise
  const drainApps = upstreams.map(item => item.name).filter(name => ['console', 'workflow', 'aims'].includes(name))
  raw.scheduler = { drain: { enabled: true, apps: drainApps }, policySync: { enabled: true } }
  return validateConfig({ ...raw, ...overrides })
}
