// Enterprise Host → Workflow topology, driven only by explicit process
// configuration. Never derive any part of it from request headers, the
// shared tenant setting or runtimeConfig.public.
//
//   HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED unset → managed-cloud default: the Host
//     approval panel stays hidden and the Workflow bridge keeps using Foundation
//     service discovery (behaviour before this switch existed).
//   'false' → disabled: the panel is hidden and the bridge fails closed (503)
//     without consulting discovery.
//   'true'  → Host-local Workflow: the panel is shown and the bridge dials only
//     HZY_ENTERPRISE_WORKFLOW_ORIGIN, which must be a loopback HTTP origin.
// Any other value, or an origin without 'true', is a configuration error.

export const HOST_WORKFLOW_ENABLED_ENV = 'HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED'
export const HOST_WORKFLOW_ORIGIN_ENV = 'HZY_ENTERPRISE_WORKFLOW_ORIGIN'
// Workflow is mounted under this base path (NUXT_APP_BASE_URL=/workflow/).
export const HOST_WORKFLOW_BASE_PATH = '/workflow'

const loopbackHosts = new Set(['127.0.0.1', '[::1]'])

export class HostWorkflowConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'HostWorkflowConfigError'
  }
}

/**
 * Accept only an exact `http://127.0.0.1:<port>` or `http://[::1]:<port>`
 * origin (an optional trailing slash is tolerated). Hostnames such as
 * `localhost`, shorthand addresses, credentials, paths, queries, fragments
 * and implicit ports are refused, so the value cannot leave the machine.
 */
export function parseLoopbackHttpOrigin(value, name = HOST_WORKFLOW_ORIGIN_ENV) {
  const raw = typeof value === 'string' ? value.trim() : ''
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new HostWorkflowConfigError(`${name} must be a loopback HTTP origin`)
  }
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (raw !== url.origin && raw !== `${url.origin}/`)) {
    throw new HostWorkflowConfigError(`${name} must be a loopback HTTP origin with an explicit port and no credentials or path`)
  }
  return url.origin
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ mode: 'discovery' | 'disabled' } | { mode: 'loopback', origin: string, apiBaseUrl: string }}
 */
export function resolveEnterpriseHostWorkflowConfig(env = process.env) {
  const enabled = typeof env[HOST_WORKFLOW_ENABLED_ENV] === 'string' ? env[HOST_WORKFLOW_ENABLED_ENV].trim() : ''
  const origin = typeof env[HOST_WORKFLOW_ORIGIN_ENV] === 'string' ? env[HOST_WORKFLOW_ORIGIN_ENV].trim() : ''
  if (!['', 'true', 'false'].includes(enabled)) {
    throw new HostWorkflowConfigError(`${HOST_WORKFLOW_ENABLED_ENV} must be 'true' or 'false'`)
  }
  if (enabled !== 'true') {
    if (origin) throw new HostWorkflowConfigError(`${HOST_WORKFLOW_ORIGIN_ENV} requires ${HOST_WORKFLOW_ENABLED_ENV}=true`)
    return { mode: enabled === 'false' ? 'disabled' : 'discovery' }
  }
  if (!origin) throw new HostWorkflowConfigError(`${HOST_WORKFLOW_ENABLED_ENV}=true requires ${HOST_WORKFLOW_ORIGIN_ENV}`)
  const checked = parseLoopbackHttpOrigin(origin)
  return { mode: 'loopback', origin: checked, apiBaseUrl: `${checked}${HOST_WORKFLOW_BASE_PATH}` }
}
