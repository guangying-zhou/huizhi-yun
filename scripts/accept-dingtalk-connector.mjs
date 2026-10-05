#!/usr/bin/env node
import { createHash } from 'node:crypto'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const SCRIPT = 'accept-dingtalk-connector'
const REQUIRED_DINGTALK_ORIGINS = ['https://api.dingtalk.com', 'https://oapi.dingtalk.com']
const REQUIRED_CAPABILITIES = [
  ['notifications.send', 'POST', '/v1/notifications/send', 'connector-runtime:notifications:send'],
  ['identity.dingtalk.exchange', 'POST', '/v1/identity/dingtalk/exchange', 'connector-runtime:identity:dingtalk:exchange'],
  ['people.dingtalk.sync', 'POST', '/v1/people-sync-jobs', 'connector-runtime:people:sync']
]

export class DingTalkAcceptanceError extends Error {}

function text(value) {
  return String(value ?? '').trim()
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function consumeOption(argv, index, raw) {
  const separator = raw.indexOf('=')
  const name = separator >= 0 ? raw.slice(0, separator) : raw
  const value = separator >= 0 ? raw.slice(separator + 1) : argv[index + 1]
  if (!value || value.startsWith('--')) throw new DingTalkAcceptanceError(`--${name} requires a value`)
  return { name, value, nextIndex: separator >= 0 ? index : index + 1 }
}

function normalizeOrigin(value, name, allowHttp) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new DingTalkAcceptanceError(`--${name} must be an absolute URL`)
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new DingTalkAcceptanceError(`--${name} must be a clean origin without credentials, path, query, or fragment`)
  }
  if (url.protocol !== 'https:' && !(allowHttp && loopback && url.protocol === 'http:')) {
    throw new DingTalkAcceptanceError(`--${name} must use HTTPS; loopback HTTP additionally requires --allow-http`)
  }
  return url.origin
}

function normalizeCookie(value) {
  const normalized = text(value)
  if (!normalized) return ''
  return normalized.includes('=') ? normalized : `console_session=${normalized}`
}

export function parseArgs(argv, env = process.env) {
  const args = {
    gatewayUrl: '',
    runtimeUrl: '',
    primary: '',
    expectedProviders: [],
    cookieEnv: '',
    cookie: '',
    recipient: '',
    changeId: '',
    timeoutMs: 15000,
    allowHttp: false,
    execute: false,
    confirm: '',
    probeLoginStart: false,
    checkIntegration: false,
    activateNotifications: false,
    activateIdentity: false,
    sendTest: false,
    startPeopleSync: false,
    includeDiagnostics: false,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--') continue
    if (raw === '--help' || raw === '-h') { args.help = true; continue }
    if (raw === '--allow-http') { args.allowHttp = true; continue }
    if (raw === '--execute') { args.execute = true; continue }
    if (raw === '--probe-login-start') { args.probeLoginStart = true; continue }
    if (raw === '--check-integration') { args.checkIntegration = true; continue }
    if (raw === '--activate-notifications') { args.activateNotifications = true; continue }
    if (raw === '--activate-identity') { args.activateIdentity = true; continue }
    if (raw === '--send-test') { args.sendTest = true; continue }
    if (raw === '--start-people-sync') { args.startPeopleSync = true; continue }
    if (raw === '--include-diagnostics') { args.includeDiagnostics = true; continue }
    if (!raw.startsWith('--')) throw new DingTalkAcceptanceError(`unexpected argument: ${raw}`)
    const option = consumeOption(argv, index, raw.slice(2))
    index = option.nextIndex
    switch (option.name) {
      case 'gateway-url': args.gatewayUrl = option.value; break
      case 'runtime-url': args.runtimeUrl = option.value; break
      case 'primary': args.primary = option.value.toLowerCase(); break
      case 'expected-providers': args.expectedProviders = option.value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean); break
      case 'cookie-env': args.cookieEnv = option.value; break
      case 'recipient': args.recipient = option.value; break
      case 'change-id': args.changeId = option.value; break
      case 'timeout-ms': args.timeoutMs = Number(option.value); break
      case 'confirm': args.confirm = option.value; break
      case 'cookie':
      case 'authorization':
      case 'token':
      case 'secret':
      case 'app-secret':
        throw new DingTalkAcceptanceError(`--${option.name} is forbidden; credentials must remain in Console Vault or a named cookie environment variable`)
      default: throw new DingTalkAcceptanceError(`unknown option: --${option.name}`)
    }
  }
  if (args.help) return args
  if (!args.gatewayUrl) throw new DingTalkAcceptanceError('--gateway-url is required')
  if (!args.runtimeUrl) throw new DingTalkAcceptanceError('--runtime-url is required')
  args.gatewayUrl = normalizeOrigin(args.gatewayUrl, 'gateway-url', args.allowHttp)
  args.runtimeUrl = normalizeOrigin(args.runtimeUrl, 'runtime-url', args.allowHttp)
  if (args.primary && !['oidc', 'cas', 'wecom', 'dingtalk'].includes(args.primary)) {
    throw new DingTalkAcceptanceError('--primary must be oidc, cas, wecom, or dingtalk')
  }
  if (args.expectedProviders.some(provider => !['oidc', 'cas', 'wecom', 'dingtalk'].includes(provider))) {
    throw new DingTalkAcceptanceError('--expected-providers contains an unsupported provider')
  }
  args.expectedProviders = [...new Set(args.expectedProviders)]
  if (args.primary && args.expectedProviders.length && !args.expectedProviders.includes(args.primary)) {
    throw new DingTalkAcceptanceError('--expected-providers must include --primary')
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 60000) {
    throw new DingTalkAcceptanceError('--timeout-ms must be an integer between 1000 and 60000')
  }
  const actionCount = actionFlags(args).length
  if (actionCount && !text(args.changeId)) throw new DingTalkAcceptanceError('--change-id is required when an action is selected')
  if (args.sendTest && (!text(args.recipient) || args.recipient.length > 256)) {
    throw new DingTalkAcceptanceError('--recipient is required with --send-test and must not exceed 256 characters')
  }
  const needsCookie = args.includeDiagnostics || actionFlags(args).some(code => code !== 'login.start')
  if (needsCookie) {
    if (!args.cookieEnv) throw new DingTalkAcceptanceError('--cookie-env is required for authenticated Console checks or actions')
    args.cookie = normalizeCookie(env[args.cookieEnv])
    if (!args.cookie) throw new DingTalkAcceptanceError(`environment variable is empty: ${args.cookieEnv}`)
  }
  return args
}

function actionFlags(args) {
  return [
    args.checkIntegration && 'integration.check',
    args.activateNotifications && 'notifications.activate',
    args.activateIdentity && 'identity.activate',
    args.probeLoginStart && 'login.start',
    args.sendTest && 'notification.send_test',
    args.startPeopleSync && 'people.sync'
  ].filter(Boolean)
}

function actionDefinitions(args) {
  const keyDigest = sha256(`${args.gatewayUrl}|${args.changeId}`).slice(0, 32)
  const definitions = []
  if (args.checkIntegration) definitions.push({ code: 'integration.check', method: 'POST', path: '/api/v1/console/integrations/dingtalk.default/check', body: {} })
  if (args.activateNotifications) definitions.push({ code: 'notifications.activate', method: 'POST', path: '/api/v1/console/connector-runtime/notification-activation', body: { enabled: true } })
  if (args.activateIdentity) definitions.push({ code: 'identity.activate', method: 'POST', path: '/api/v1/console/connector-runtime/identity-activation', body: { enabled: true, provider: 'dingtalk' } })
  if (args.probeLoginStart) definitions.push({ code: 'login.start', method: 'GET', path: '/api/auth/dingtalk-login?redirect=%2F' })
  if (args.sendTest) definitions.push({
    code: 'notification.send_test',
    method: 'POST',
    path: '/api/v1/console/connector-runtime/dingtalk-test',
    body: { integrationCode: 'dingtalk.default', touser: args.recipient, requestKey: `dingtalk-accept:${keyDigest}` }
  })
  if (args.startPeopleSync) definitions.push({
    code: 'people.sync',
    method: 'POST',
    path: '/api/v1/console/connector-runtime/people-sync-jobs',
    body: { objectScopes: ['organization', 'people'], idempotencyKey: `dingtalk-accept-people-${keyDigest}` }
  })
  return definitions
}

export function buildExecutionPlan(args) {
  const definitions = actionDefinitions(args)
  const summary = {
    schemaVersion: 1,
    gatewayUrl: args.gatewayUrl,
    runtimeUrl: args.runtimeUrl,
    expectedPrimary: args.primary || null,
    expectedProviders: args.expectedProviders,
    changeIdSha256: definitions.length ? sha256(args.changeId) : null,
    recipientSha256: args.sendTest ? sha256(args.recipient) : null,
    actions: definitions.map(({ code, method, path }) => ({ code, method, path }))
  }
  return { ...summary, confirmationSha256: sha256(summary) }
}

function unwrap(payload) {
  return payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload
}

async function readJson(response, label) {
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new DingTalkAcceptanceError(`${label} did not return JSON`)
  }
  if (!response.ok) throw new DingTalkAcceptanceError(`${label} returned HTTP ${response.status}`)
  return unwrap(payload)
}

async function getJson(fetchImpl, url, label, args, cookie = '') {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(args.timeoutMs)
  })
  if (response.status >= 300 && response.status < 400) throw new DingTalkAcceptanceError(`${label} unexpectedly redirected`)
  return await readJson(response, label)
}

function assertPublicLoginConfig(config, args) {
  const serialized = JSON.stringify(config).toLowerCase()
  for (const forbidden of ['corpsecret', 'appsecret', 'clientsecret', 'access_token', 'accesstoken']) {
    if (serialized.includes(forbidden)) throw new DingTalkAcceptanceError(`public login config exposes forbidden field ${forbidden}`)
  }
  const providers = Array.isArray(config.enabledProviders) ? config.enabledProviders.map(String) : []
  if (args.primary && config.mode !== args.primary) {
    throw new DingTalkAcceptanceError(`expected primary ${args.primary}, got ${config.mode || 'none'}`)
  }
  if (args.expectedProviders.length && JSON.stringify(providers) !== JSON.stringify(args.expectedProviders)) {
    throw new DingTalkAcceptanceError(`expected providers ${args.expectedProviders.join(',')}, got ${providers.join(',')}`)
  }
  return { primary: text(config.mode), enabledProviders: providers, dingtalkConfigured: Boolean(config.dingtalkClientId), publicSecretsExposed: false }
}

function assertRuntime(health, capabilities) {
  if (health.runtimeProduct !== 'hzy-connector-runtime' || health.status !== 'ok' || health.authMode !== 'jwt' || health.deliveryStore !== 'ready') {
    throw new DingTalkAcceptanceError('Connector Runtime health contract is not ready')
  }
  if (!Array.isArray(health.providers) || !health.providers.includes('dingtalk')) {
    throw new DingTalkAcceptanceError('Connector Runtime health is missing DingTalk provider')
  }
  if (capabilities.schemaVersion !== 'hzy.connector-capabilities.v1' || capabilities.runtimeProduct !== 'hzy-connector-runtime' || capabilities.arbitraryHttpProxy !== false) {
    throw new DingTalkAcceptanceError('Connector Runtime capability boundary is invalid')
  }
  const provider = Array.isArray(capabilities.providers) ? capabilities.providers.find(item => item?.code === 'dingtalk') : null
  if (!provider || provider.dynamicTargetAllowed !== false || provider.credentialSource !== 'console-vault'
    || JSON.stringify(provider.allowedOrigins) !== JSON.stringify(REQUIRED_DINGTALK_ORIGINS)) {
    throw new DingTalkAcceptanceError('DingTalk provider origin or credential boundary is invalid')
  }
  for (const [code, method, path, scope] of REQUIRED_CAPABILITIES) {
    const capability = Array.isArray(capabilities.capabilities) ? capabilities.capabilities.find(item => item?.code === code) : null
    if (!capability || capability.version !== 'v1' || capability.method !== method || capability.path !== path || capability.requiredScope !== scope) {
      throw new DingTalkAcceptanceError(`DingTalk capability contract is invalid: ${code}`)
    }
  }
  return {
    product: health.runtimeProduct,
    version: text(health.version),
    tenant: text(health.tenant),
    deployment: text(health.deployment),
    authMode: health.authMode,
    deliveryStore: health.deliveryStore,
    arbitraryHttpProxy: false,
    allowedOrigins: [...provider.allowedOrigins],
    capabilities: REQUIRED_CAPABILITIES.map(item => item[0])
  }
}

function projectAction(definition, data, response) {
  if (definition.code === 'login.start') {
    const location = response.headers.get('location') || ''
    let target
    try { target = new URL(location) } catch { throw new DingTalkAcceptanceError('DingTalk login start returned an invalid redirect') }
    if (![302, 303].includes(response.status) || target.host !== 'login.dingtalk.com' || !target.searchParams.get('state')) {
      throw new DingTalkAcceptanceError('DingTalk login start did not return the expected state-bound redirect')
    }
    return { code: definition.code, status: response.status, host: target.host, state: 'present' }
  }
  if (definition.code === 'integration.check') {
    if (data.status !== 'healthy' || data.summary?.checkMode !== 'dingtalk_config_vault_connector_configured') {
      throw new DingTalkAcceptanceError('DingTalk Integration/Vault readiness check failed')
    }
    return { code: definition.code, status: data.status, checkMode: data.summary.checkMode }
  }
  if (definition.code === 'notifications.activate' || definition.code === 'identity.activate') {
    if (data.enabled !== true) throw new DingTalkAcceptanceError(`${definition.code} did not become enabled`)
    return { code: definition.code, enabled: true, version: text(data.version) || null }
  }
  if (definition.code === 'notification.send_test') {
    if (data.status !== 'sent' || data.deliveryMode !== 'connector-runtime' || data.replayVerified !== true) {
      throw new DingTalkAcceptanceError('DingTalk test notification lacks successful replay evidence')
    }
    return { code: definition.code, status: data.status, deliveryMode: data.deliveryMode, replayVerified: true }
  }
  if (definition.code === 'people.sync') {
    if (!/^crj_[A-Za-z0-9_-]{20,64}$/.test(text(data.jobId)) || !['pending', 'running', 'success'].includes(text(data.status))) {
      throw new DingTalkAcceptanceError('DingTalk People sync did not return a valid job')
    }
    return { code: definition.code, jobIdSha256: sha256(data.jobId), status: data.status }
  }
  throw new DingTalkAcceptanceError(`unsupported action projection: ${definition.code}`)
}

async function executeAction(fetchImpl, args, definition) {
  const headers = { accept: 'application/json' }
  if (definition.code !== 'login.start') headers.cookie = args.cookie
  if (definition.method === 'POST') headers['content-type'] = 'application/json'
  const response = await fetchImpl(`${args.gatewayUrl}${definition.path}`, {
    method: definition.method,
    headers,
    ...(definition.body ? { body: JSON.stringify(definition.body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(args.timeoutMs)
  })
  if (definition.code === 'login.start') return projectAction(definition, null, response)
  return projectAction(definition, await readJson(response, definition.code), response)
}

export async function runDingTalkAcceptance(args, { fetchImpl = fetch } = {}) {
  const loginConfig = await getJson(fetchImpl, `${args.gatewayUrl}/api/auth/login-config`, 'login config', args)
  const [health, capabilities] = await Promise.all([
    getJson(fetchImpl, `${args.runtimeUrl}/runtime/health`, 'runtime health', args),
    getJson(fetchImpl, `${args.runtimeUrl}/runtime/capabilities`, 'runtime capabilities', args)
  ])
  const checks = {
    login: assertPublicLoginConfig(loginConfig, args),
    runtime: assertRuntime(health, capabilities)
  }
  if (args.includeDiagnostics) {
    const diagnostics = await getJson(fetchImpl, `${args.gatewayUrl}/api/v1/console/connector-runtime/diagnostics`, 'connector diagnostics', args, args.cookie)
    if (diagnostics.runtimeProduct !== 'hzy-connector-runtime' || !diagnostics.metrics?.collectedAt) {
      throw new DingTalkAcceptanceError('Connector Runtime diagnostics contract is invalid')
    }
    checks.diagnostics = {
      product: diagnostics.runtimeProduct,
      version: text(diagnostics.version),
      collectedAt: diagnostics.metrics.collectedAt,
      databaseBytes: Number(diagnostics.metrics.databaseBytes),
      deliveryTotal: Object.values(diagnostics.metrics.deliveries || {}).reduce((sum, value) => sum + Number(value || 0), 0),
      peopleJobTotal: Object.values(diagnostics.metrics.peopleJobs || {}).reduce((sum, value) => sum + Number(value || 0), 0)
    }
  }

  const plan = buildExecutionPlan(args)
  if (!args.execute || plan.actions.length === 0) return { mode: plan.actions.length ? 'preview' : 'read-only', checks, plan }
  if (!/^[a-f0-9]{64}$/.test(args.confirm) || args.confirm !== plan.confirmationSha256) {
    throw new DingTalkAcceptanceError('--confirm must exactly match the current preview confirmation SHA-256')
  }
  const actions = []
  for (const definition of actionDefinitions(args)) actions.push(await executeAction(fetchImpl, args, definition))
  return { mode: 'execute', checks, confirmationSha256: plan.confirmationSha256, actions }
}

export function usage() {
  return `Usage (read-only public/runtime checks):
  pnpm run accept:dingtalk-connector -- --gateway-url https://wiztek.huizhi.yun \\
    --runtime-url https://connector.example.com

Add --expected-providers oidc,dingtalk --primary oidc for an exact login check.
Authenticated diagnostics require --include-diagnostics --cookie-env <ENV_NAME>.

Side effects are opt-in: --check-integration, --activate-notifications,
--activate-identity, --probe-login-start, --send-test --recipient <userid>,
and --start-people-sync. First review preview confirmationSha256, then repeat
with --execute --confirm <sha256> --change-id <id>. Authenticated actions read
the Console session only from --cookie-env. AppSecret remains in Console Vault.`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(usage()); return }
  const result = await runDingTalkAcceptance(args)
  console.log(JSON.stringify(result, null, 2))
  if (result.mode === 'preview') console.error(`[${SCRIPT}] preview only; no selected action was executed`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
