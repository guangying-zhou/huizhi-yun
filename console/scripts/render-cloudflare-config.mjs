import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicKey } from 'node:crypto'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(process.env.HZY_CONSOLE_WRANGLER_OUTPUT || resolve(rootDir, '.wrangler.generated.jsonc'))
const CLOUDFLARE_CONSOLE_ROUTE = 'console.huizhi.yun'
const CLOUDFLARE_CONSOLE_ZONE = 'huizhi.yun'
const CLOUDFLARE_CONSOLE_PUBLIC_URL = `https://${CLOUDFLARE_CONSOLE_ROUTE}`
const CLOUDFLARE_PLATFORM_URL = 'https://huizhi.yun'
// Console 自身 self-fetch 读不到系统参数，审批中心 workflow-proxy 通过环境变量解析 Workflow
// 地址；默认指向 workflow 子域，可用 HZY_WORKFLOW_API_URL 覆盖。
const CLOUDFLARE_WORKFLOW_API_URL = 'https://workflow.huizhi.yun/workflow'
const CLOUDFLARE_CONSOLE_CACHE_SCOPE = 'managed-cloud-console'
const CLOUDFLARE_DEPLOYMENT_ENVIRONMENT = 'prod'

function value(name, fallback = '') {
  return String(process.env[name] || fallback).trim()
}

function parseEnvFile(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = normalized.slice(0, separatorIndex).trim()
    let item = normalized.slice(separatorIndex + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    const quote = item[0]
    if ((quote === '"' || quote === '\'') && item.endsWith(quote)) {
      item = item.slice(1, -1)
    }
    env[key] = item
  }
  return env
}

function loadEnvFile(path) {
  if (!existsSync(path)) return false
  for (const [key, item] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (!process.env[key]) process.env[key] = item
  }
  return true
}

function trimTrailingSlash(input) {
  return String(input || '').replace(/\/+$/, '')
}

function isPlaceholderValue(input) {
  const normalized = String(input || '').trim().toLowerCase()
  if (!normalized) return true
  return normalized.includes('<')
    || normalized.includes('>')
    || normalized.includes('changeme')
    || normalized.includes('change-me')
    || normalized.includes('placeholder')
    || normalized.includes('example')
    || normalized === '00000000-0000-0000-0000-000000000000'
}

function requireConcreteValue(name, input) {
  if (isPlaceholderValue(input)) {
    console.error(`Invalid placeholder value for ${name}. Set the real production value before generating the Cloudflare config.`)
    process.exit(1)
  }
}

function requireHyperdriveId(name, input) {
  if (!/^[0-9a-f]{32}$/i.test(String(input || '').trim())) {
    console.error(`Invalid ${name}. Expected the 32-character hexadecimal Hyperdrive config id from "wrangler hyperdrive list", not a UUID, name or placeholder.`)
    process.exit(1)
  }
}

function normalizePemInput(input) {
  return String(input || '').trim().replace(/\\n/g, '\n')
}

function requireEd25519PublicKey(name, input) {
  try {
    const key = createPublicKey(normalizePemInput(input))
    if (key.asymmetricKeyType !== 'ed25519') {
      console.error(`Invalid ${name}. Expected an Ed25519 public key, got ${key.asymmetricKeyType || 'unknown'}.`)
      process.exit(1)
    }
  } catch (error) {
    console.error(`Invalid ${name}. Expected a parseable Ed25519 public PEM: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function booleanValue(name, fallback = 'false') {
  const raw = value(name, fallback).toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  console.error(`Invalid boolean value for ${name}: ${value(name)}`)
  process.exit(1)
}

loadEnvFile(resolve(rootDir, '.env.cloudflare'))
loadEnvFile(resolve(rootDir, '.env.cloudflare.local'))

const hyperdriveId = value('HZY_CONSOLE_HYPERDRIVE_ID')
if (!hyperdriveId) {
  console.error('Missing HZY_CONSOLE_HYPERDRIVE_ID. Create a Hyperdrive config for hzy_console, then export its id before deploy.')
  process.exit(1)
}

const routePattern = value('HZY_CONSOLE_ROUTE_PATTERN')
const zoneName = value('HZY_CONSOLE_ZONE_NAME')
const workersDev = value('HZY_CONSOLE_WORKERS_DEV', routePattern && zoneName ? 'false' : 'true') !== 'false'
const customDomain = value('HZY_CONSOLE_CUSTOM_DOMAIN', routePattern && !/[/*]/.test(routePattern) ? 'true' : 'false') === 'true'
const publicUrl = trimTrailingSlash(value('HZY_DEPLOYMENT_PUBLIC_URL', CLOUDFLARE_CONSOLE_PUBLIC_URL))
const platformUrl = trimTrailingSlash(value('HZY_PLATFORM_URL', CLOUDFLARE_PLATFORM_URL))
const activationMode = value('HZY_CONSOLE_ACTIVATION_MODE', 'managed-cloud-multitenant')
const deploymentEnvironment = value('HZY_PLATFORM_ENVIRONMENT', value('HZY_DEPLOYMENT_ENVIRONMENT', CLOUDFLARE_DEPLOYMENT_ENVIRONMENT)).toLowerCase()
const deploymentProfile = value('HZY_DEPLOYMENT_PROFILE', value('NUXT_PUBLIC_DEPLOYMENT_PROFILE', value('DEPLOYMENT_PROFILE', 'managed-cloud-direct-db')))
const appBasePath = value('HZY_APP_BASE_PATH', '/')
const bundleCacheBackend = value('HZY_PLATFORM_BUNDLE_CACHE_BACKEND', 'db').toLowerCase()
const bundleCacheScope = value('HZY_PLATFORM_BUNDLE_CACHE_SCOPE', CLOUDFLARE_CONSOLE_CACHE_SCOPE)
const bundleCacheLegacyFallback = booleanValue('HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK') ? 'true' : 'false'
const trustTenantGateway = booleanValue('HZY_CONSOLE_TRUST_TENANT_GATEWAY') ? 'true' : 'false'
const consoleRunMode = value('HZY_CONSOLE_RUN_MODE', 'prod')
const runtimeEnabled = booleanValue('HZY_PLATFORM_RUNTIME_ENABLED', 'true') ? 'true' : 'false'
const heartbeatEnabled = booleanValue('HZY_PLATFORM_HEARTBEAT_ENABLED', 'false') ? 'true' : 'false'
const bundleRefreshOnBoot = booleanValue('HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', 'false') ? 'true' : 'false'
const authClientMaterialize = booleanValue('HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE', 'true') ? 'true' : 'false'
const authClientMaterializeMode = value('HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE', value('HZY_AUTH_CLIENT_MATERIALIZE_MODE', 'upsert')).toLowerCase()
const backgroundJobsEnabled = booleanValue('HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'false') ? 'true' : 'false'
const devPolicyBypass = booleanValue('HZY_CONSOLE_DEV_POLICY_BYPASS', 'false') ? 'true' : 'false'
const collabMode = value('CONSOLE_COLLAB_MODE', 'disabled').toLowerCase()
const authSigningKeyAutogenerate = booleanValue('CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', 'false') ? 'true' : 'false'
const authSigningKeyRotateUnusable = booleanValue('CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', 'false') ? 'true' : 'false'
const dbName = value('DB_NAME', 'hzy_console')

if (bundleCacheBackend !== 'db') {
  console.error([
    'Invalid Console Cloudflare runtime cache backend.',
    'Cloudflare Workers cannot use the file cache for persistent platform runtime state.',
    'Set HZY_PLATFORM_BUNDLE_CACHE_BACKEND=db and configure HZY_PLATFORM_BUNDLE_CACHE_SCOPE.'
  ].join('\n'))
  process.exit(1)
}

if (bundleCacheLegacyFallback !== 'false') {
  console.error([
    'Invalid Console Cloudflare runtime cache fallback.',
    'Console prod/test shared runtimes must not read legacy unscoped platform runtime cache keys.',
    'Set HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false before generating the Cloudflare config.'
  ].join('\n'))
  process.exit(1)
}

if (trustTenantGateway !== 'false') {
  console.error([
    'Invalid Console Tenant Gateway trust setting.',
    'The current prod/test/dev isolation model requires deploymentCode and cache scope to come from env, not request headers.',
    'Set HZY_CONSOLE_TRUST_TENANT_GATEWAY=false before generating the Cloudflare config.'
  ].join('\n'))
  process.exit(1)
}

const requiredProdFlags = [
  ['HZY_CONSOLE_ROUTE_PATTERN', routePattern, CLOUDFLARE_CONSOLE_ROUTE],
  ['HZY_CONSOLE_ZONE_NAME', zoneName, CLOUDFLARE_CONSOLE_ZONE],
  ['HZY_CONSOLE_WORKERS_DEV', workersDev ? 'true' : 'false', 'false'],
  ['HZY_DEPLOYMENT_PUBLIC_URL', publicUrl, CLOUDFLARE_CONSOLE_PUBLIC_URL],
  ['HZY_PLATFORM_URL', platformUrl, CLOUDFLARE_PLATFORM_URL],
  ['HZY_CONSOLE_ACTIVATION_MODE', activationMode, 'managed-cloud-multitenant'],
  ['HZY_PLATFORM_ENVIRONMENT', deploymentEnvironment, CLOUDFLARE_DEPLOYMENT_ENVIRONMENT],
  ['HZY_PLATFORM_BUNDLE_CACHE_SCOPE', bundleCacheScope, CLOUDFLARE_CONSOLE_CACHE_SCOPE],
  ['DB_NAME', dbName, 'hzy_console'],
  ['HZY_CONSOLE_RUN_MODE', consoleRunMode, 'prod'],
  ['HZY_PLATFORM_RUNTIME_ENABLED', runtimeEnabled, 'true'],
  ['HZY_PLATFORM_HEARTBEAT_ENABLED', heartbeatEnabled, 'false'],
  ['HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', bundleRefreshOnBoot, 'false'],
  ['HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE', authClientMaterialize, 'true'],
  ['HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE', authClientMaterializeMode, 'upsert'],
  ['HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', backgroundJobsEnabled, 'false'],
  ['HZY_CONSOLE_DEV_POLICY_BYPASS', devPolicyBypass, 'false'],
  ['CONSOLE_COLLAB_MODE', collabMode, 'disabled'],
  ['CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', authSigningKeyAutogenerate, 'false'],
  ['CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', authSigningKeyRotateUnusable, 'false']
]
const invalidProdFlags = requiredProdFlags.filter(([, actual, expected]) => actual !== expected)
if (invalidProdFlags.length) {
  console.error([
    'Invalid Console Cloudflare production isolation settings.',
    'Console prod on Cloudflare must run as the console.huizhi.yun managed-cloud runtime, not as a private/local/dev/test instance.',
    `Fix ${invalidProdFlags.map(([name,, expected]) => `${name}=${expected}`).join(', ')} before generating the Cloudflare config.`
  ].join('\n'))
  process.exit(1)
}

const optionalVars = [
  'HZY_PLATFORM_SIGNING_KID',
  'HZY_PLATFORM_SIGNING_PUBKEY',
  'HZY_PLATFORM_BUNDLE_CACHE_SCOPE',
  'HZY_PLATFORM_HEARTBEAT_INTERVAL_MS'
].reduce((vars, key) => {
  const current = value(key)
  if (current) vars[key] = current
  return vars
}, {})

const requiredConsoleActivationVars = [
  'HZY_PLATFORM_SIGNING_KID',
  'HZY_PLATFORM_SIGNING_PUBKEY'
]
const missingConsoleActivationVars = requiredConsoleActivationVars.filter(key => !value(key))
if (missingConsoleActivationVars.length) {
  console.error([
    'Missing Console platform activation vars for Cloudflare deployment.',
    `Set ${missingConsoleActivationVars.join(', ')} in console/.env.cloudflare or the shell environment, then regenerate the config.`,
    'HZY_CLOUDFLARE_INTERNAL_TOKEN should remain a Cloudflare secret. Legacy HZY_CONSOLE_PLATFORM_SERVICE_TOKEN and HZY_TENANT_GATEWAY_INTERNAL_TOKEN are still supported as secrets.'
  ].join('\n'))
  process.exit(1)
}

for (const [name, item] of [
  ['HZY_CONSOLE_HYPERDRIVE_ID', hyperdriveId],
  ['HZY_CONSOLE_WORKER_NAME', value('HZY_CONSOLE_WORKER_NAME', 'hzy-console-prod')],
  ['HZY_CONSOLE_ZONE_NAME', zoneName],
  ['HZY_PLATFORM_SIGNING_KID', value('HZY_PLATFORM_SIGNING_KID')],
  ['HZY_PLATFORM_SIGNING_PUBKEY', value('HZY_PLATFORM_SIGNING_PUBKEY')]
]) {
  requireConcreteValue(name, item)
}
requireHyperdriveId('HZY_CONSOLE_HYPERDRIVE_ID', hyperdriveId)
requireEd25519PublicKey('HZY_PLATFORM_SIGNING_PUBKEY', value('HZY_PLATFORM_SIGNING_PUBKEY'))

const config = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: value('HZY_CONSOLE_WORKER_NAME', 'hzy-console-prod'),
  main: '.output/server/index.mjs',
  compatibility_date: value('HZY_CONSOLE_COMPATIBILITY_DATE', '2026-05-23'),
  compatibility_flags: ['nodejs_compat'],
  assets: {
    directory: '.output/public',
    binding: 'ASSETS'
  },
  observability: {
    enabled: true
  },
  workers_dev: workersDev,
  ...(routePattern && zoneName
    ? {
        routes: [
          {
            pattern: routePattern,
            zone_name: zoneName,
            ...(customDomain ? { custom_domain: true } : {})
          }
        ]
      }
    : {}),
  hyperdrive: [
    {
      binding: 'HYPERDRIVE',
      id: hyperdriveId
    }
  ],
  vars: {
    NODE_ENV: 'production',
    HZY_CLOUDFLARE_RUNTIME: 'true',
    HZY_DEPLOYMENT_PROFILE: deploymentProfile,
    HZY_APP_CODE: 'console',
    HZY_APP_BASE_PATH: appBasePath,
    HZY_DEPLOYMENT_PUBLIC_URL: publicUrl,
    HZY_CONSOLE_URL: publicUrl,
    HZY_PLATFORM_URL: platformUrl,
    HZY_CONSOLE_ACTIVATION_MODE: activationMode,
    HZY_PLATFORM_ENVIRONMENT: deploymentEnvironment,
    HZY_AUTH_MODE: 'console',
    HZY_LEGACY_AUTH_BRIDGE: 'false',
    HZY_WORKFLOW_API_URL: value('HZY_WORKFLOW_API_URL', CLOUDFLARE_WORKFLOW_API_URL),
    CONSOLE_COLLAB_MODE: collabMode,
    HZY_RUNTIME_APP_CONTROL_ENABLED: 'false',
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: bundleCacheBackend,
    HZY_PLATFORM_BUNDLE_CACHE_SCOPE: bundleCacheScope,
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: bundleCacheLegacyFallback,
    HZY_CONSOLE_RUN_MODE: consoleRunMode,
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: trustTenantGateway,
    HZY_PLATFORM_RUNTIME_ENABLED: runtimeEnabled,
    HZY_PLATFORM_HEARTBEAT_ENABLED: heartbeatEnabled,
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: bundleRefreshOnBoot,
    HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: authClientMaterialize,
    HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE: authClientMaterializeMode,
    HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: backgroundJobsEnabled,
    HZY_CONSOLE_DEV_POLICY_BYPASS: devPolicyBypass,
    CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE: authSigningKeyAutogenerate,
    CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE: authSigningKeyRotateUnusable,
    DB_NAME: dbName,
    NUXT_PUBLIC_APP_DISPLAY_NAME: '汇智云控制台',
    NUXT_PUBLIC_APP_ICON: 'i-lucide-monitor-cog',
    ...optionalVars
  }
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`)
console.info(`Generated ${outputPath}`)
