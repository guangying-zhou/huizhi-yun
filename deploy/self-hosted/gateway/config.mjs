// Production configuration for the self-hosted Tenant Gateway.
//
// One JSON file carries both variables and secrets. It must be a regular file,
// owner-only (0600/0400), owned by the gateway user, not reached through a
// symlink, inside a directory that group/others cannot write, and small. Any
// deviation refuses startup; nothing is ever echoed back with secret values.
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { isIP } from 'node:net'
import { collabDeploymentCode } from '../collab-deployment.mjs'
import { isTailnetAddress, LOOPBACK_LISTEN_HOSTS, MAX_ALLOWED_PEERS } from './ingress-peers.mjs'

export const MAX_CONFIG_BYTES = 64 * 1024
export const DEFAULT_REGISTRY_RESOLVE_PATH = '/api/platform/internal/tenant-gateway/resolve'
const DISABLED_ORIGIN = 'https://disabled.invalid'
// The self-hosted Console is served under NUXT_APP_BASE_URL=/console/ (deploy/self-hosted/README.md); the shared gateway code
// uses this to address it for its own scheduled calls (policy sync, Console drain, directory-connector proxy).
export const CONSOLE_BASE_PATH = '/console'

// Application codes the Worker routes with an origin variable and (optionally)
// a Service Binding. `collab` has no binding; it is dialled by origin only.
export const APP_SETTINGS = Object.freeze({
  console: { originEnv: 'HZY_CONSOLE_ORIGIN', binding: 'HZY_CONSOLE_SERVICE' },
  enterprise: { originEnv: 'HZY_ENTERPRISE_ORIGIN', binding: 'HZY_ENTERPRISE_SERVICE' },
  aims: { originEnv: 'HZY_AIMS_ORIGIN', binding: 'HZY_AIMS_SERVICE' },
  assets: { originEnv: 'HZY_ASSETS_ORIGIN', binding: 'HZY_ASSETS_SERVICE' },
  altoc: { originEnv: 'HZY_ALTOC_ORIGIN', binding: 'HZY_ALTOC_SERVICE' },
  codocs: { originEnv: 'HZY_CODOCS_ORIGIN', binding: 'HZY_CODOCS_SERVICE' },
  finance: { originEnv: 'HZY_FINANCE_ORIGIN', binding: 'HZY_FINANCE_SERVICE' },
  people: { originEnv: 'HZY_PEOPLE_ORIGIN', binding: 'HZY_PEOPLE_SERVICE' },
  workflow: { originEnv: 'HZY_WORKFLOW_ORIGIN', binding: 'HZY_WORKFLOW_SERVICE' },
  collab: { originEnv: 'HZY_COLLAB_ORIGIN', binding: null }
})
// Routes that exist in the Worker but are never served by a self-hosted site.
const ALWAYS_DISABLED_ORIGINS = ['HZY_OBSERVABILITY_ORIGIN', 'HZY_WEBDEV_ORIGIN']
// Apps the Worker scheduler may wake (see SCHEDULER_APPS in the Worker).
export const DRAIN_APPS = new Set(['aims', 'altoc', 'assets', 'console', 'finance', 'people', 'workflow'])

const hostnamePattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const placeholderPattern = /^(?:REPLACE|CHANGE|PLACEHOLDER|REQUIRED|TODO|EXAMPLE|<)/i

export class ConfigError extends Error {
  constructor(issues) {
    super(`Gateway configuration rejected:\n- ${issues.join('\n- ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

/**
 * Read the configuration file with the protections above. Only the parsed value
 * is returned; the caller validates it with `validateConfig`.
 */
export async function readConfigFile(path, { maxBytes = MAX_CONFIG_BYTES, expectedUid = process.getuid?.() } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new ConfigError(['config path must be absolute'])
  const directory = await stat(dirname(path))
  if (!directory.isDirectory() || (directory.mode & 0o022) !== 0) {
    throw new ConfigError(['config directory must not be writable by group or others'])
  }
  let handle
  try {
    // O_NOFOLLOW makes a symlinked final component fail with ELOOP.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK || 0))
  } catch (error) {
    const code = error?.code === 'ELOOP' || error?.code === 'EMLINK' ? 'config file must not be a symlink' : 'config file cannot be opened'
    throw new ConfigError([code])
  }
  try {
    const info = await handle.stat()
    const issues = []
    if (!info.isFile()) issues.push('config file must be a regular file')
    if ((info.mode & 0o777 & ~0o600) !== 0) issues.push('config file must be owner-only (chmod 600)')
    if (expectedUid !== undefined && info.uid !== expectedUid) issues.push('config file must be owned by the gateway user')
    if (info.nlink !== 1) issues.push('config file must not have hard links')
    if (info.size > maxBytes) issues.push(`config file must be at most ${maxBytes} bytes`)
    if (issues.length) throw new ConfigError(issues)
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length <= maxBytes) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > maxBytes) throw new ConfigError([`config file must be at most ${maxBytes} bytes`])
    try {
      return JSON.parse(buffer.subarray(0, length).toString('utf8'))
    } catch {
      throw new ConfigError(['config file is not valid JSON'])
    }
  } finally {
    await handle.close()
  }
}

export async function loadConfig(path, options) {
  const value = await readConfigFile(path, options)
  return validateConfig(value)
}

/** Validate and normalize; throws ConfigError listing every issue (never values). */
export function validateConfig(input) {
  const issues = []
  if (!isRecord(input)) throw new ConfigError(['config must be a JSON object'])
  allowKeys(input, ['_notice', 'schemaVersion', 'site', 'platform', 'runtime', 'apps', 'enterprise',
    'listeners', 'limits', 'scheduler', 'secrets'], 'config', issues)
  if (input.schemaVersion !== 1) issues.push('schemaVersion must be 1')

  const site = record(input.site)
  allowKeys(site, ['publicHost', 'tenantCode', 'environment', 'tenantDomainSuffix'], 'site', issues)
  const publicHost = hostname(site.publicHost, 'site.publicHost', issues)
  const tenantCode = identifier(site.tenantCode, 'site.tenantCode', issues)
  const environment = identifier(site.environment, 'site.environment', issues)
  const tenantDomainSuffix = site.tenantDomainSuffix === undefined ? 'huizhi.yun' : hostname(site.tenantDomainSuffix, 'site.tenantDomainSuffix', issues)

  const platform = record(input.platform)
  allowKeys(platform, ['origin', 'registryResolvePath'], 'platform', issues)
  const platformOrigin = httpsOrigin(platform.origin, 'platform.origin', issues)
  const registryResolvePath = platform.registryResolvePath === undefined ? DEFAULT_REGISTRY_RESOLVE_PATH : platform.registryResolvePath
  if (typeof registryResolvePath !== 'string' || !/^\/[A-Za-z0-9/_-]{1,200}\/resolve$/.test(registryResolvePath) || registryResolvePath.includes('//')) {
    issues.push('platform.registryResolvePath must be an absolute path ending in /resolve')
  }

  const runtime = record(input.runtime)
  allowKeys(runtime, ['endpoint', 'runtimeCode'], 'runtime', issues)
  const runtimeEndpoint = httpsOrigin(runtime.endpoint, 'runtime.endpoint', issues, { allowPath: true })
  if (runtimeEndpoint && isLoopbackHost(new URL(runtimeEndpoint).hostname)) {
    issues.push('runtime.endpoint must be the canonical registered HTTPS endpoint, not a loopback dial address')
  }
  const runtimeCode = identifier(runtime.runtimeCode, 'runtime.runtimeCode', issues)

  const appsInput = record(input.apps)
  allowKeys(appsInput, Object.keys(APP_SETTINGS), 'apps', issues)
  const apps = {}
  const usedOrigins = new Map()
  for (const [appCode, value] of Object.entries(appsInput)) {
    const app = record(value)
    allowKeys(app, ['origin', 'deploymentCode'], `apps.${appCode}`, issues)
    const origin = loopbackOrigin(app.origin, `apps.${appCode}.origin`, issues)
    const deploymentCode = appCode === 'collab' && app.deploymentCode === undefined
      ? '' : identifier(app.deploymentCode, `apps.${appCode}.deploymentCode`, issues)
    if (origin) {
      if (usedOrigins.has(origin)) issues.push(`apps.${appCode}.origin duplicates apps.${usedOrigins.get(origin)}.origin`)
      usedOrigins.set(origin, appCode)
    }
    apps[appCode] = Object.freeze({ origin, deploymentCode })
  }
  if (!apps.console) issues.push('apps.console is required')
  // Collab is a registered Platform deployment `${tenant}-collab` (G-9). When the
  // gateway pins it, it must be exactly that code; the registry answer is then
  // compared to it like every other pinned app, so drift fails closed.
  if (apps.collab?.deploymentCode && tenantCode && apps.collab.deploymentCode !== collabDeploymentCode(tenantCode)) {
    issues.push('apps.collab.deploymentCode must equal the registered <site.tenantCode>-collab deployment')
  }

  const enterpriseInput = record(input.enterprise)
  allowKeys(enterpriseInput, ['pilot', 'authPilot'], 'enterprise', issues)
  const enterprise = {
    pilot: booleanOr(enterpriseInput.pilot, false, 'enterprise.pilot', issues),
    authPilot: booleanOr(enterpriseInput.authPilot, false, 'enterprise.authPilot', issues)
  }
  if ((enterprise.pilot || enterprise.authPilot) && !apps.enterprise) issues.push('enterprise.pilot/authPilot require apps.enterprise')

  const listenersInput = record(input.listeners)
  allowKeys(listenersInput, ['ingress', 'health'], 'listeners', issues)
  const listeners = {}
  const ports = new Set()
  for (const name of ['ingress', 'health']) {
    const listener = record(listenersInput[name])
    const isIngress = name === 'ingress'
    allowKeys(listener, isIngress ? ['host', 'port', 'allowedPeers'] : ['host', 'port'], `listeners.${name}`, issues)
    const loopback = LOOPBACK_LISTEN_HOSTS.includes(listener.host)
    // Only the public ingress may bind a Tailscale address (nginx → tailnet →
    // gateway); health and every internal surface stay loopback-only.
    const tailnet = isIngress && isTailnetAddress(listener.host)
    if (!loopback && !tailnet) {
      issues.push(isIngress
        ? 'listeners.ingress.host must be 127.0.0.1, ::1 or one Tailscale 100.64.0.0/10 IPv4 address'
        : 'listeners.health.host must be 127.0.0.1 or ::1')
    }
    if (!Number.isInteger(listener.port) || listener.port < 1024 || listener.port > 65535) issues.push(`listeners.${name}.port must be 1024-65535`)
    else if (ports.has(listener.port)) issues.push(`listeners.${name}.port must be unique`)
    ports.add(listener.port)
    if (!isIngress) {
      listeners[name] = Object.freeze({ host: listener.host, port: listener.port })
      continue
    }
    const allowedPeers = tailnet ? tailnetPeers(listener.allowedPeers, listener.host, issues) : []
    if (!tailnet && listener.allowedPeers !== undefined) {
      issues.push('listeners.ingress.allowedPeers is only allowed with a Tailscale listener host')
    }
    listeners[name] = Object.freeze({
      host: listener.host,
      port: listener.port,
      mode: tailnet ? 'tailnet' : 'loopback',
      allowedPeers: Object.freeze(allowedPeers)
    })
  }

  const limitsInput = record(input.limits)
  allowKeys(limitsInput, ['maxRequestBodyBytes', 'maxHeaderBytes', 'requestTimeoutMs', 'maxWebSockets',
    'webSocketIdleTimeoutMs', 'platformTimeoutMs'], 'limits', issues)
  const limits = Object.freeze({
    maxRequestBodyBytes: integerOr(limitsInput.maxRequestBodyBytes, 100 * 1024 * 1024, 1024, 1024 * 1024 * 1024, 'limits.maxRequestBodyBytes', issues),
    maxHeaderBytes: integerOr(limitsInput.maxHeaderBytes, 16 * 1024, 4096, 64 * 1024, 'limits.maxHeaderBytes', issues),
    requestTimeoutMs: integerOr(limitsInput.requestTimeoutMs, 300_000, 5_000, 3_600_000, 'limits.requestTimeoutMs', issues),
    maxWebSockets: integerOr(limitsInput.maxWebSockets, 512, 1, 65_536, 'limits.maxWebSockets', issues),
    webSocketIdleTimeoutMs: integerOr(limitsInput.webSocketIdleTimeoutMs, 300_000, 10_000, 3_600_000, 'limits.webSocketIdleTimeoutMs', issues),
    platformTimeoutMs: integerOr(limitsInput.platformTimeoutMs, 15_000, 1_000, 60_000, 'limits.platformTimeoutMs', issues)
  })

  const schedulerInput = record(input.scheduler)
  allowKeys(schedulerInput, ['drain', 'policySync', 'alertAfterConsecutiveFailures'], 'scheduler', issues)
  const drainInput = record(schedulerInput.drain)
  allowKeys(drainInput, ['enabled', 'apps', 'maxWakes', 'concurrency', 'maxWallTimeMs', 'requestTimeoutMs'], 'scheduler.drain', issues)
  const drainApps = Array.isArray(drainInput.apps) ? [...new Set(drainInput.apps)] : []
  if (drainInput.apps !== undefined && (!Array.isArray(drainInput.apps) || drainApps.length !== drainInput.apps.length)) {
    issues.push('scheduler.drain.apps must be a list of unique app codes')
  }
  for (const appCode of drainApps) {
    if (!DRAIN_APPS.has(appCode)) issues.push(`scheduler.drain.apps: ${String(appCode).slice(0, 32)} is not a scheduler app`)
    else if (!apps[appCode]) issues.push(`scheduler.drain.apps: ${appCode} must be configured under apps (local deployments only)`)
  }
  const drain = Object.freeze({
    enabled: booleanOr(drainInput.enabled, true, 'scheduler.drain.enabled', issues),
    apps: Object.freeze(drainApps),
    maxWakes: integerOr(drainInput.maxWakes, 16, 1, 32, 'scheduler.drain.maxWakes', issues),
    concurrency: integerOr(drainInput.concurrency, 4, 1, 16, 'scheduler.drain.concurrency', issues),
    maxWallTimeMs: integerOr(drainInput.maxWallTimeMs, 45_000, 1_000, 50_000, 'scheduler.drain.maxWallTimeMs', issues),
    requestTimeoutMs: integerOr(drainInput.requestTimeoutMs, 30_000, 1_000, 35_000, 'scheduler.drain.requestTimeoutMs', issues)
  })
  if (drain.enabled && drain.apps.length === 0) issues.push('scheduler.drain.apps must list at least one local app when drains are enabled')
  const policyInput = record(schedulerInput.policySync)
  allowKeys(policyInput, ['enabled', 'intervalMinutes', 'consoleTimeoutMs'], 'scheduler.policySync', issues)
  const policySync = Object.freeze({
    enabled: booleanOr(policyInput.enabled, true, 'scheduler.policySync.enabled', issues),
    intervalMinutes: integerOr(policyInput.intervalMinutes, 1, 1, 15, 'scheduler.policySync.intervalMinutes', issues),
    consoleTimeoutMs: integerOr(policyInput.consoleTimeoutMs, 35_000, 1_000, 120_000, 'scheduler.policySync.consoleTimeoutMs', issues)
  })
  const scheduler = Object.freeze({
    drain,
    policySync,
    alertAfterConsecutiveFailures: integerOr(schedulerInput.alertAfterConsecutiveFailures, 3, 1, 100, 'scheduler.alertAfterConsecutiveFailures', issues)
  })

  const secretsInput = record(input.secrets)
  allowKeys(secretsInput, ['gatewayInternalToken', 'platformRegistryToken'], 'secrets', issues)
  const gatewayInternalToken = secret(secretsInput.gatewayInternalToken, 'secrets.gatewayInternalToken', issues)
  const platformRegistryToken = secret(secretsInput.platformRegistryToken, 'secrets.platformRegistryToken', issues)
  if (gatewayInternalToken && gatewayInternalToken === platformRegistryToken) {
    issues.push('secrets.gatewayInternalToken and secrets.platformRegistryToken must differ')
  }

  if (issues.length) throw new ConfigError(issues)
  const config = {
    site: Object.freeze({ publicHost, tenantCode, environment, tenantDomainSuffix }),
    platform: Object.freeze({ origin: platformOrigin, registryResolvePath, registryUrl: `${platformOrigin}${registryResolvePath}` }),
    runtime: Object.freeze({ endpoint: runtimeEndpoint, runtimeCode }),
    apps: Object.freeze(apps),
    enterprise: Object.freeze(enterprise),
    listeners: Object.freeze(listeners),
    limits,
    scheduler
  }
  // Non-enumerable so accidental serialization of the normalized config never
  // includes secret values.
  Object.defineProperty(config, 'secrets', {
    value: Object.freeze({ gatewayInternalToken, platformRegistryToken }),
    enumerable: false
  })
  return Object.freeze(config)
}

/**
 * Worker `env` for this site: plain string variables plus Service Binding
 * objects. Only configured local apps get a live binding/origin; every other
 * route resolves to a disabled origin. `HZY_PLATFORM_SERVICE` is deliberately
 * absent: Platform is reached over plain HTTPS at the configured origin.
 */
export function buildWorkerEnv(config, { createBinding, disabledBinding }) {
  const { site, apps, scheduler } = config
  const env = {
    HZY_TENANT_GATEWAY_REGISTRY_URL: config.platform.registryUrl,
    // Registry bearer. HZY_CLOUDFLARE_INTERNAL_TOKEN is never set: the Worker
    // would otherwise prefer it for both the registry and the Gateway trust
    // header, sending the Gateway secret to Platform.
    HZY_PLATFORM_INTERNAL_TOKEN: config.secrets.platformRegistryToken,
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: config.secrets.gatewayInternalToken,
    HZY_ALLOWED_TENANTS: site.tenantCode,
    HZY_DEFAULT_TENANT: site.tenantCode,
    HZY_DEPLOYMENT_ENVIRONMENT: site.environment,
    HZY_TENANT_DOMAIN_SUFFIX: site.tenantDomainSuffix,
    HZY_TENANT_GATEWAY_EXPECTED_BINDINGS_JSON: JSON.stringify({ [site.publicHost]: expectedBinding(config) }),
    // Pinned Runtime endpoint used only when the Platform registry withholds it (see withStaticDataRuntimeEndpoint in the Worker).
    HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_ENDPOINT: config.runtime.endpoint,
    HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_CODE: config.runtime.runtimeCode,
    // Adds Console to the trusted service route catalog (Worker buildTrustedServiceRouteCatalog); Cloudflare leaves it unset.
    HZY_TENANT_GATEWAY_SERVICE_ROUTES_INCLUDE_CONSOLE: 'true',
    HZY_ENTERPRISE_PILOT: config.enterprise.pilot ? 'true' : 'false',
    HZY_ENTERPRISE_AUTH_PILOT: config.enterprise.authPilot ? 'true' : 'false',
    HZY_POLICY_SYNC_HOSTS: scheduler.policySync.enabled ? site.publicHost : '',
    HZY_POLICY_SYNC_CONSOLE_TIMEOUT_MS: String(scheduler.policySync.consoleTimeoutMs),
    HZY_TENANT_GATEWAY_SCHEDULER_SHARD_COUNT: '1',
    HZY_TENANT_GATEWAY_SCHEDULER_SHARD_INDEX: '0',
    HZY_TENANT_GATEWAY_SCHEDULER_PAGE_SIZE: '1',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_PAGES: '1',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_TENANTS: '1',
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_WAKES: String(scheduler.drain.maxWakes),
    HZY_TENANT_GATEWAY_SCHEDULER_CONCURRENCY: String(scheduler.drain.concurrency),
    HZY_TENANT_GATEWAY_SCHEDULER_MAX_WALL_TIME_MS: String(scheduler.drain.maxWallTimeMs),
    HZY_TENANT_GATEWAY_SCHEDULER_REQUEST_TIMEOUT_MS: String(scheduler.drain.requestTimeoutMs)
  }
  if (config.enterprise.pilot || config.enterprise.authPilot) {
    env.HZY_ENTERPRISE_HOST_ALLOWLIST_JSON = JSON.stringify([{
      host: site.publicHost,
      tenantCode: site.tenantCode,
      environment: site.environment,
      deploymentCode: apps.enterprise.deploymentCode
    }])
  }
  for (const [appCode, settings] of Object.entries(APP_SETTINGS)) {
    const app = apps[appCode]
    if (settings.originEnv) env[settings.originEnv] = app ? app.origin : DISABLED_ORIGIN
    if (settings.binding) env[settings.binding] = app ? createBinding(app.origin) : disabledBinding
  }
  if (apps.console) env.HZY_CONSOLE_BASE_PATH = CONSOLE_BASE_PATH
  for (const name of ALWAYS_DISABLED_ORIGINS) env[name] = DISABLED_ORIGIN
  return env
}

export function expectedBinding(config) {
  const apps = {}
  for (const [appCode, app] of Object.entries(config.apps)) {
    if (app.deploymentCode) apps[appCode] = app.deploymentCode
  }
  return {
    tenantCode: config.site.tenantCode,
    environment: config.site.environment,
    apps,
    dataRuntime: { endpoint: config.runtime.endpoint, runtimeCode: config.runtime.runtimeCode }
  }
}

/** Every origin the gateway may dial. Anything else is refused by egress. */
export function allowedEgressOrigins(config) {
  const origins = new Map([[config.platform.origin, 'platform']])
  for (const app of Object.values(config.apps)) origins.set(app.origin, 'loopback')
  return origins
}

export function secretValues(config) {
  return Object.values(config.secrets || {}).filter(Boolean)
}

export function isLoopbackHost(value) {
  const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function hostname(value, name, issues) {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!host || !hostnamePattern.test(host) || isIP(host) || placeholderPattern.test(host)) {
    issues.push(`${name} must be a DNS hostname`)
    return ''
  }
  return host
}

function identifier(value, name, issues) {
  if (typeof value !== 'string' || !identifierPattern.test(value) || placeholderPattern.test(value)) {
    issues.push(`${name} must be a configured identifier`)
    return ''
  }
  return value
}

function httpsOrigin(value, name, issues, { allowPath = false } = {}) {
  let url
  try { url = new URL(String(value || '')) } catch {
    issues.push(`${name} must be an absolute HTTPS URL`)
    return ''
  }
  if (url.protocol !== 'https:') {
    issues.push(`${name} must use HTTPS`)
    return ''
  }
  if (url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== '/')
    || placeholderPattern.test(url.hostname) || url.hostname.endsWith('.invalid')) {
    issues.push(`${name} must be a plain HTTPS ${allowPath ? 'URL' : 'origin'}`)
    return ''
  }
  return allowPath ? url.toString().replace(/\/+$/, '') : url.origin
}

function loopbackOrigin(value, name, issues) {
  let url
  try { url = new URL(String(value || '')) } catch {
    issues.push(`${name} must be an absolute loopback URL`)
    return ''
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!['http:', 'https:'].includes(url.protocol) || (host !== '::1' && !/^127(?:\.\d{1,3}){3}$/.test(host))
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    issues.push(`${name} must be http(s)://127.x.x.x:port or http(s)://[::1]:port with no path`)
    return ''
  }
  return url.origin
}

// Issue texts name positions only, never addresses.
function tailnetPeers(value, listenHost, issues) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ALLOWED_PEERS) {
    issues.push(`listeners.ingress.allowedPeers must list 1-${MAX_ALLOWED_PEERS} Tailscale peer IPv4 addresses when listening on a Tailscale address`)
    return []
  }
  const peers = []
  value.forEach((peer, index) => {
    if (!isTailnetAddress(peer)) issues.push(`listeners.ingress.allowedPeers[${index}] must be one Tailscale 100.64.0.0/10 IPv4 address`)
    else if (peer === listenHost) issues.push(`listeners.ingress.allowedPeers[${index}] must not be the listener address`)
    else if (peers.includes(peer)) issues.push(`listeners.ingress.allowedPeers[${index}] is a duplicate`)
    else peers.push(peer)
  })
  return peers
}

function secret(value, name, issues) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 4096 || /\s/.test(value) || placeholderPattern.test(value)) {
    issues.push(`${name} must be a real secret of at least 32 non-whitespace characters`)
    return ''
  }
  return value
}

function booleanOr(value, fallback, name, issues) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') issues.push(`${name} must be a boolean`)
  return value === true
}

function integerOr(value, fallback, min, max, name, issues) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) {
    issues.push(`${name} must be an integer between ${min} and ${max}`)
    return fallback
  }
  return value
}

function allowKeys(value, allowed, name, issues) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${name}.${key.slice(0, 64)} is not allowed`)
  }
}

function record(value) {
  return isRecord(value) ? value : {}
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
