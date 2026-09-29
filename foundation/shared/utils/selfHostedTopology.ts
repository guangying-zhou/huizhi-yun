// Self-hosted single-site topology (G-10).
//
// In the self-hosted deployment every tenant process runs on one server and
// there are no Cloudflare Service Bindings. The public ingress strips every
// client-supplied `x-hzy-*` header, so server-to-server calls must not fall
// back to the public URL: they dial the local process directly, exactly like a
// Service Binding would. The mapping comes only from process configuration,
// validated at startup, and is never derived from request headers or exposed
// through runtimeConfig.public.
//
//   HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON  {"console":"http://127.0.0.1:3000",...}
//     appCode -> loopback HTTP origin. `console` is required once enabled.
//   HZY_SELF_HOSTED_RUNTIME_ENDPOINT      canonical HTTPS Runtime endpoint as
//                                          registered in Platform (unchanged
//                                          signed/bound identity)
//   HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN   loopback HTTP origin that replaces only
//                                          the TCP dial of that endpoint
//
// Both groups are optional and independent; the two Runtime variables must be
// set together. hzy0 (HZY0_* flags) and Cloudflare builds must not set them.

export const SELF_HOSTED_SERVICE_ORIGINS_ENV = 'HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON'
export const SELF_HOSTED_RUNTIME_ENDPOINT_ENV = 'HZY_SELF_HOSTED_RUNTIME_ENDPOINT'
export const SELF_HOSTED_RUNTIME_DIAL_ORIGIN_ENV = 'HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN'

export const SELF_HOSTED_SERVICE_APPS = Object.freeze([
  'console', 'enterprise', 'workflow', 'aims', 'assets', 'altoc', 'codocs', 'finance', 'people', 'collab'
] as const)

export type SelfHostedServiceApp = typeof SELF_HOSTED_SERVICE_APPS[number]

export interface SelfHostedTopology {
  services: Readonly<Partial<Record<SelfHostedServiceApp, string>>> | null
  runtime: Readonly<{ canonicalEndpoint: string, dialOrigin: string }> | null
}

export class SelfHostedTopologyConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SelfHostedTopologyConfigError'
  }
}

type EnvRecord = Record<string, string | undefined>

const HZY0_FLAGS = ['HZY0_LOCAL_ENTERPRISE', 'HZY0_WORKFLOW_LOCAL_ONLY', 'HZY0_LOCAL_CONSOLE_FACADE']
const CLOUDFLARE_FLAGS = ['HZY_CLOUDFLARE_BUILD', 'HZY_CLOUDFLARE_RUNTIME']
const MAX_JSON_LENGTH = 4096

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isLoopbackHost(hostname: string) {
  if (hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
}

/**
 * Exact `http://127.x.x.x:<port>` or `http://[::1]:<port>` origin (an optional
 * trailing slash is tolerated). Hostnames such as `localhost`, shorthand or
 * integer addresses, HTTPS, credentials, paths, queries, fragments and implicit
 * ports are refused. Error messages never include the rejected value.
 */
export function parseSelfHostedLoopbackOrigin(value: unknown, name: string) {
  const raw = text(value)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SelfHostedTopologyConfigError(`${name} must be a loopback HTTP origin`)
  }
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname) || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (raw !== url.origin && raw !== `${url.origin}/`)) {
    throw new SelfHostedTopologyConfigError(`${name} must be a loopback HTTP origin with an explicit port and no credentials or path`)
  }
  return url.origin
}

/** Canonical registered Runtime endpoint: HTTPS, no credentials/query/fragment, never loopback. */
export function parseSelfHostedRuntimeCanonicalEndpoint(value: unknown, name = SELF_HOSTED_RUNTIME_ENDPOINT_ENV) {
  const raw = text(value)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SelfHostedTopologyConfigError(`${name} must be an absolute HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || raw.includes('?') || raw.includes('#')) {
    throw new SelfHostedTopologyConfigError(`${name} must be a plain HTTPS URL`)
  }
  if (isLoopbackHost(url.hostname) || url.hostname === 'localhost') {
    throw new SelfHostedTopologyConfigError(`${name} must be the canonical registered endpoint, not a loopback dial address`)
  }
  return normalizeRuntimeEndpoint(url.toString())
}

/** Comparison form of a Runtime endpoint: parsed, trailing slashes removed. '' when not a URL. */
export function normalizeRuntimeEndpoint(value: unknown) {
  const raw = text(value)
  if (!raw) return ''
  try {
    return new URL(raw).toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function parseServices(raw: string) {
  if (raw.length > MAX_JSON_LENGTH) {
    throw new SelfHostedTopologyConfigError(`${SELF_HOSTED_SERVICE_ORIGINS_ENV} is too large`)
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new SelfHostedTopologyConfigError(`${SELF_HOSTED_SERVICE_ORIGINS_ENV} must be a JSON object`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SelfHostedTopologyConfigError(`${SELF_HOSTED_SERVICE_ORIGINS_ENV} must be a JSON object`)
  }
  const services: Partial<Record<SelfHostedServiceApp, string>> = {}
  for (const [key, origin] of Object.entries(value as Record<string, unknown>)) {
    if (!(SELF_HOSTED_SERVICE_APPS as readonly string[]).includes(key)) {
      throw new SelfHostedTopologyConfigError(`${SELF_HOSTED_SERVICE_ORIGINS_ENV} contains an unsupported application code`)
    }
    services[key as SelfHostedServiceApp] = parseSelfHostedLoopbackOrigin(origin, `${SELF_HOSTED_SERVICE_ORIGINS_ENV}.${key}`)
  }
  if (!services.console) {
    throw new SelfHostedTopologyConfigError(`${SELF_HOSTED_SERVICE_ORIGINS_ENV} must include console`)
  }
  return Object.freeze(services)
}

/**
 * Parse and validate the self-hosted topology. Returns null when nothing is
 * configured (managed cloud, hzy0 and local development keep their behaviour).
 * Any partial, malformed or conflicting configuration throws.
 */
export function parseSelfHostedTopology(env: EnvRecord): SelfHostedTopology | null {
  const servicesRaw = text(env[SELF_HOSTED_SERVICE_ORIGINS_ENV])
  const runtimeEndpointRaw = text(env[SELF_HOSTED_RUNTIME_ENDPOINT_ENV])
  const runtimeDialRaw = text(env[SELF_HOSTED_RUNTIME_DIAL_ORIGIN_ENV])
  if (!servicesRaw && !runtimeEndpointRaw && !runtimeDialRaw) return null

  if (HZY0_FLAGS.some(name => text(env[name]) === 'true')) {
    throw new SelfHostedTopologyConfigError('Self-hosted topology must not be combined with hzy0 local test flags')
  }
  if (CLOUDFLARE_FLAGS.some(name => text(env[name]) === 'true')) {
    throw new SelfHostedTopologyConfigError('Self-hosted topology must not be set on Cloudflare builds')
  }
  if (Boolean(runtimeEndpointRaw) !== Boolean(runtimeDialRaw)) {
    throw new SelfHostedTopologyConfigError(`${SELF_HOSTED_RUNTIME_ENDPOINT_ENV} and ${SELF_HOSTED_RUNTIME_DIAL_ORIGIN_ENV} must be set together`)
  }

  const services = servicesRaw ? parseServices(servicesRaw) : null
  const runtime = runtimeEndpointRaw
    ? Object.freeze({
        canonicalEndpoint: parseSelfHostedRuntimeCanonicalEndpoint(runtimeEndpointRaw),
        dialOrigin: parseSelfHostedLoopbackOrigin(runtimeDialRaw, SELF_HOSTED_RUNTIME_DIAL_ORIGIN_ENV)
      })
    : null
  return Object.freeze({ services, runtime })
}

/**
 * Replace only the TCP dial of the configured canonical Runtime endpoint.
 * Returns the canonical endpoint unchanged when no Runtime mapping exists.
 * A configured mapping never silently falls back to another (public) Runtime:
 * a different canonical endpoint is a binding error.
 */
export function selfHostedRuntimeDialEndpoint(topology: SelfHostedTopology | null, canonicalEndpoint: string) {
  if (!topology?.runtime || !canonicalEndpoint) return canonicalEndpoint
  const normalized = normalizeRuntimeEndpoint(canonicalEndpoint)
  if (!normalized || normalized !== topology.runtime.canonicalEndpoint) {
    throw new SelfHostedTopologyConfigError('Runtime endpoint does not match the self-hosted Runtime binding')
  }
  const path = new URL(normalized).pathname.replace(/\/+$/, '')
  return `${topology.runtime.dialOrigin}${path}`
}
