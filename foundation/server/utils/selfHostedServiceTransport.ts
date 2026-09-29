import { createError } from 'h3'
import type { CloudflareServiceBinding } from './consoleServiceBinding'
import {
  parseSelfHostedTopology,
  SELF_HOSTED_RUNTIME_DIAL_ORIGIN_ENV,
  SELF_HOSTED_RUNTIME_ENDPOINT_ENV,
  SELF_HOSTED_SERVICE_APPS,
  SELF_HOSTED_SERVICE_ORIGINS_ENV,
  SelfHostedTopologyConfigError,
  selfHostedRuntimeDialEndpoint,
  type SelfHostedServiceApp,
  type SelfHostedTopology
} from '../../shared/utils/selfHostedTopology'

/**
 * Self-hosted equivalent of Cloudflare Service Bindings (G-10).
 *
 * The self-hosted Tenant Gateway strips every client `x-hzy-*` header on its
 * public ingress, so a server-to-server call that falls back to the public URL
 * loses (or is refused) its trusted source identity. With
 * `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON` set, Foundation's binding resolvers
 * return this loopback transport instead: it behaves like a Service Binding —
 * the destination is fixed by server configuration, only the path and query of
 * the requested URL are used, and the caller's headers (already composed by the
 * Foundation trusted-context helpers) are sent unchanged. Redirects are never
 * followed, so a response cannot move the call off the machine.
 */

let cached: { key: string, value: SelfHostedTopology | null } | null = null

function envKey(env: Record<string, string | undefined>) {
  return JSON.stringify([
    env[SELF_HOSTED_SERVICE_ORIGINS_ENV] || '',
    env[SELF_HOSTED_RUNTIME_ENDPOINT_ENV] || '',
    env[SELF_HOSTED_RUNTIME_DIAL_ORIGIN_ENV] || '',
    env.HZY0_LOCAL_ENTERPRISE || '',
    env.HZY0_WORKFLOW_LOCAL_ONLY || '',
    env.HZY0_LOCAL_CONSOLE_FACADE || '',
    env.HZY_CLOUDFLARE_BUILD || '',
    env.HZY_CLOUDFLARE_RUNTIME || ''
  ])
}

function processEnv(): Record<string, string | undefined> {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

/** Throws SelfHostedTopologyConfigError for invalid configuration (used at startup). */
export function loadSelfHostedTopology(env: Record<string, string | undefined> = processEnv()) {
  const key = envKey(env)
  if (cached?.key === key) return cached.value
  const value = parseSelfHostedTopology(env)
  cached = { key, value }
  return value
}

/** Request-time accessor: an invalid configuration fails closed as 503 without echoing values. */
export function resolveSelfHostedTopology(env?: Record<string, string | undefined>) {
  try {
    return loadSelfHostedTopology(env)
  } catch (error) {
    if (error instanceof SelfHostedTopologyConfigError) {
      throw createError({ statusCode: 503, message: 'Self-hosted service topology is misconfigured.' })
    }
    throw error
  }
}

export function isSelfHostedServiceTopologyEnabled(env?: Record<string, string | undefined>) {
  return Boolean(resolveSelfHostedTopology(env)?.services)
}

export function createLoopbackServiceBinding(
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch
): CloudflareServiceBinding {
  return {
    async fetch(input: string | URL | Request, init?: RequestInit) {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        throw createError({ statusCode: 500, message: 'Self-hosted service transport accepts only URL inputs.' })
      }
      let target: URL
      try {
        target = new URL(String(input))
      } catch {
        throw createError({ statusCode: 500, message: 'Self-hosted service transport received an invalid URL.' })
      }
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        throw createError({ statusCode: 500, message: 'Self-hosted service transport received an unsupported URL.' })
      }
      const headers = new Headers(init?.headers)
      headers.delete('host')
      return await fetchImpl(`${origin}${target.pathname}${target.search}`, {
        ...init,
        headers,
        redirect: 'manual'
      })
    }
  }
}

/**
 * Loopback transport for `appCode`, or null when self-hosted service origins
 * are not configured. When they are configured, an application without an
 * origin fails closed (503) instead of falling back to the public ingress.
 */
export function selfHostedServiceBinding(
  appCodeInput: string,
  options: { env?: Record<string, string | undefined>, fetchImpl?: typeof fetch } = {}
): CloudflareServiceBinding | null {
  const topology = resolveSelfHostedTopology(options.env)
  if (!topology?.services) return null
  const appCode = String(appCodeInput || '').trim().toLowerCase()
  const origin = (SELF_HOSTED_SERVICE_APPS as readonly string[]).includes(appCode)
    ? topology.services[appCode as SelfHostedServiceApp]
    : undefined
  if (!origin) {
    throw createError({ statusCode: 503, message: 'Self-hosted service origin is not configured for the target application.' })
  }
  return createLoopbackServiceBinding(origin, options.fetchImpl)
}

/**
 * Map the configured canonical Runtime endpoint to its loopback dial origin.
 * Unchanged when no self-hosted Runtime mapping is configured; a mismatching
 * endpoint fails closed (503).
 */
export function resolveSelfHostedRuntimeDialEndpoint(canonicalEndpoint: string, env?: Record<string, string | undefined>) {
  const topology = resolveSelfHostedTopology(env)
  try {
    return selfHostedRuntimeDialEndpoint(topology, canonicalEndpoint)
  } catch (error) {
    if (error instanceof SelfHostedTopologyConfigError) {
      throw createError({ statusCode: 503, message: 'Runtime endpoint does not match the self-hosted Runtime binding.' })
    }
    throw error
  }
}
