#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createPublicKey } from 'node:crypto'
import process from 'node:process'

const SECRET_VAR_NAMES = [
  'HZY_CLOUDFLARE_INTERNAL_TOKEN',
  'HZY_CONSOLE_PLATFORM_SERVICE_TOKEN',
  'HZY_TENANT_GATEWAY_INTERNAL_TOKEN',
  'HZY_CONSOLE_VAULT_MASTER_KEY',
  'HZY_CONSOLE_DIAGNOSTICS_TOKEN',
  'SSO_OIDC_CLIENT_SECRET',
  'CONSOLE_AUTH_SIGNING_PRIVATE_JWK',
  'WECOM_CORPSECRET'
]

const EXPECTED_CLOUDFLARE_CONSOLE_ROUTE = 'console.huizhi.yun'
const EXPECTED_CLOUDFLARE_CONSOLE_ZONE = 'huizhi.yun'
const EXPECTED_CLOUDFLARE_CONSOLE_PUBLIC_URL = 'https://console.huizhi.yun'
const EXPECTED_CLOUDFLARE_PLATFORM_URL = 'https://huizhi.yun'
const EXPECTED_CLOUDFLARE_CACHE_SCOPE = 'managed-cloud-console'
const EXPECTED_CLOUDFLARE_ENVIRONMENT = 'prod'
const SAMPLE_HYPERDRIVE_ID = '0123456789abcdef0123456789abcdef'

const TRIMMED_WRANGLER_VAR_NAMES = [
  'HZY_CLOUDFLARE_BUILD',
  'NUXT_PUBLIC_DEPLOYMENT_PROFILE',
  'NUXT_PUBLIC_APP_CODE',
  'NUXT_PUBLIC_APP_BASE_PATH',
  'NUXT_APP_BASE_URL',
  'HZY_APP_HOME_URL',
  'NUXT_PUBLIC_APP_HOME_URL',
  'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL',
  'HZY_CONSOLE_API_URL',
  'NUXT_PUBLIC_CONSOLE_URL',
  'CONSOLE_OIDC_ISSUER',
  'SSO_OIDC_REDIRECT_URI',
  'SSO_OIDC_POST_LOGOUT_REDIRECT_URI',
  'NUXT_PUBLIC_AUTH_MODE',
  'NUXT_PUBLIC_LEGACY_AUTH_BRIDGE',
  'HZY_PLATFORM_BUNDLE_CACHE_TABLE',
  'DB_CONNECTION_LIMIT',
  'NUXT_PUBLIC_APP_NAME',
  'SSO_OIDC_ENABLE',
  'SSO_OIDC_PROVIDER_CODE',
  'SSO_OIDC_ISSUER',
  'SSO_OIDC_AUTHORIZATION_ENDPOINT',
  'SSO_OIDC_TOKEN_ENDPOINT',
  'SSO_OIDC_USERINFO_ENDPOINT',
  'SSO_OIDC_END_SESSION_ENDPOINT',
  'SSO_OIDC_JWKS_URI',
  'SSO_OIDC_CLIENT_ID',
  'SSO_OIDC_SCOPE',
  'CAS_ENABLE',
  'CAS_BASE_URL',
  'WECOM_CORPID',
  'WECOM_AGENTID',
  'HZY_PLATFORM_TENANT_CODE',
  'HZY_PLATFORM_DEPLOYMENT_CODE',
  'HZY_PLATFORM_RUNTIME_TOKEN',
  'HZY_PLATFORM_LICENSE_TOKEN'
]

function usage() {
  return `
Usage:
  pnpm run validate:console-cloudflare
  pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare
  pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare --strict-env

Generates a temporary Console wrangler config with non-secret sample env and verifies
the Cloudflare prod path targets console.huizhi.yun -> huizhi.yun as a managed
multi-tenant Console Worker, uses DB runtime cache, keeps Cloudflare internal tokens
out of wrangler vars, and disables local PM2 app control / embedded Collab /
signing key automation.
When --env-file is provided, the same Cloudflare invariants are checked against that file.
Use --strict-env for final deployment validation; it requires non-secret Cloudflare ids
and Platform signing public material to be real, non-placeholder values in the env file.
`
}

function parseArgs(argv) {
  const args = {
    envFile: '',
    strictEnv: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--strict-env') {
      args.strictEnv = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
    if (name === 'env-file') {
      if (!value || value.startsWith('--')) fail('missing value for --env-file')
      args.envFile = value
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
}

function runRenderer(env) {
  const result = spawnSync(process.execPath, ['console/scripts/render-cloudflare-config.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  })

  if (result.error) throw result.error
  return result
}

function parseConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parseEnvFile(path) {
  const env = {}
  const content = readFileSync(path, 'utf8')
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

function fail(message) {
  throw new Error(message)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertAbsent(record, key, label) {
  if (Object.prototype.hasOwnProperty.call(record, key)) {
    fail(`${label}: ${key} must not be written to wrangler vars`)
  }
}

function assertBlank(record, key, label) {
  const value = record[key]
  if (typeof value === 'string' && value.trim()) {
    fail(`${label}: ${key} must be empty in tracked examples and set as a Worker secret`)
  }
}

function assertPresent(record, key, label) {
  if (!String(record[key] || '').trim()) {
    fail(`${label}: ${key} is required`)
  }
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

function assertConcrete(record, key, label) {
  assertPresent(record, key, label)
  if (isPlaceholderValue(record[key])) {
    fail(`${label}: ${key} must be a real production value, got a placeholder`)
  }
}

function normalizePemInput(input) {
  return String(input || '').trim().replace(/\\n/g, '\n')
}

function assertEd25519PublicKey(record, key, label) {
  assertConcrete(record, key, label)
  try {
    const publicKey = createPublicKey(normalizePemInput(record[key]))
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      fail(`${label}: ${key} must be an Ed25519 public key, got ${publicKey.asymmetricKeyType || 'unknown'}`)
    }
  } catch (error) {
    fail(`${label}: ${key} must be a parseable Ed25519 public PEM: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function trimTrailingSlash(input) {
  return String(input || '').replace(/\/+$/, '')
}

function assertHyperdriveId(value, label) {
  if (!/^[0-9a-f]{32}$/i.test(String(value || '').trim())) {
    fail(`${label}: HZY_CONSOLE_HYPERDRIVE_ID must be the 32-character hexadecimal Hyperdrive config id from "wrangler hyperdrive list"`)
  }
}

function nonEmptyEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([, item]) => String(item || '').trim())
  )
}

function validateCloudflareEnv(env, label, options = {}) {
  assertEqual(env.HZY_CONSOLE_ROUTE_PATTERN, EXPECTED_CLOUDFLARE_CONSOLE_ROUTE, `${label} route`)
  assertEqual(env.HZY_CONSOLE_ZONE_NAME, EXPECTED_CLOUDFLARE_CONSOLE_ZONE, `${label} zone`)
  assertEqual(trimTrailingSlash(env.HZY_DEPLOYMENT_PUBLIC_URL), EXPECTED_CLOUDFLARE_CONSOLE_PUBLIC_URL, `${label} public URL`)
  assertEqual(trimTrailingSlash(env.HZY_PLATFORM_URL), EXPECTED_CLOUDFLARE_PLATFORM_URL, `${label} Platform URL`)
  assertEqual(env.HZY_CONSOLE_ACTIVATION_MODE, 'managed-cloud-multitenant', `${label} activation mode`)
  assertEqual(env.HZY_PLATFORM_ENVIRONMENT, EXPECTED_CLOUDFLARE_ENVIRONMENT, `${label} Platform environment`)
  assertEqual(env.HZY_PLATFORM_BUNDLE_CACHE_BACKEND, 'db', `${label} cache backend`)
  assertEqual(env.HZY_PLATFORM_BUNDLE_CACHE_SCOPE, EXPECTED_CLOUDFLARE_CACHE_SCOPE, `${label} cache scope`)
  assertEqual(env.HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK, 'false', `${label} legacy fallback`)
  assertEqual(env.HZY_CONSOLE_RUN_MODE, 'prod', `${label} run mode`)
  assertEqual(env.HZY_CONSOLE_TRUST_TENANT_GATEWAY, 'false', `${label} tenant gateway trust`)
  assertEqual(env.HZY_PLATFORM_RUNTIME_ENABLED, 'true', `${label} runtime enabled`)
  assertEqual(env.HZY_PLATFORM_HEARTBEAT_ENABLED, 'false', `${label} heartbeat enabled`)
  assertEqual(env.HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT, 'false', `${label} bundle refresh on boot`)
  assertEqual(env.HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE, 'true', `${label} auth client materialize`)
  assertEqual(env.HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE, 'upsert', `${label} auth client materialize mode`)
  assertEqual(env.HZY_CONSOLE_BACKGROUND_JOBS_ENABLED, 'false', `${label} background jobs enabled`)
  assertEqual(env.HZY_CONSOLE_DEV_POLICY_BYPASS, 'false', `${label} dev policy bypass`)
  assertEqual(env.CONSOLE_COLLAB_MODE, 'disabled', `${label} collab mode`)
  assertEqual(env.CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE, 'false', `${label} auth signing key autogenerate`)
  assertEqual(env.CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE, 'false', `${label} auth signing key rotate unusable`)
  assertEqual(env.DB_NAME, 'hzy_console', `${label} DB`)
  if (env.HZY_CONSOLE_HYPERDRIVE_ID) {
    assertHyperdriveId(env.HZY_CONSOLE_HYPERDRIVE_ID, label)
  }

  if (env.HZY_CONSOLE_WORKERS_DEV) {
    assertEqual(env.HZY_CONSOLE_WORKERS_DEV, 'false', `${label} workers_dev`)
  }

  for (const key of SECRET_VAR_NAMES) {
    assertBlank(env, key, label)
  }
  for (const key of [
    'HZY_PLATFORM_TENANT_CODE',
    'HZY_PLATFORM_DEPLOYMENT_CODE',
    'HZY_PLATFORM_RUNTIME_TOKEN',
    'HZY_PLATFORM_LICENSE_TOKEN'
  ]) {
    assertBlank(env, key, label)
  }

  if (!options.strict) return

  for (const key of [
    'HZY_CONSOLE_HYPERDRIVE_ID',
    'HZY_CONSOLE_WORKER_NAME',
    'HZY_CONSOLE_ZONE_NAME',
    'HZY_PLATFORM_SIGNING_KID'
  ]) {
    assertConcrete(env, key, label)
  }
  assertEd25519PublicKey(env, 'HZY_PLATFORM_SIGNING_PUBKEY', label)

}

function validateEnvExample() {
  const examplePath = 'console/.env.cloudflare.example'
  if (!existsSync(examplePath)) {
    fail(`${examplePath} is missing`)
  }

  validateCloudflareEnv(parseEnvFile(examplePath), 'cloudflare env example')
}

function sampleEnv(outputPath, overrides = {}) {
  return {
    ...process.env,
    HZY_CONSOLE_WRANGLER_OUTPUT: outputPath,
    HZY_CONSOLE_HYPERDRIVE_ID: SAMPLE_HYPERDRIVE_ID,
    HZY_CONSOLE_WORKER_NAME: 'hzy-console-prod',
    HZY_CONSOLE_ROUTE_PATTERN: EXPECTED_CLOUDFLARE_CONSOLE_ROUTE,
    HZY_CONSOLE_ZONE_NAME: EXPECTED_CLOUDFLARE_CONSOLE_ZONE,
    HZY_CONSOLE_CUSTOM_DOMAIN: 'true',
    HZY_DEPLOYMENT_PUBLIC_URL: EXPECTED_CLOUDFLARE_CONSOLE_PUBLIC_URL,
    HZY_PLATFORM_URL: EXPECTED_CLOUDFLARE_PLATFORM_URL,
    HZY_CONSOLE_ACTIVATION_MODE: 'managed-cloud-multitenant',
    HZY_PLATFORM_ENVIRONMENT: EXPECTED_CLOUDFLARE_ENVIRONMENT,
    HZY_PLATFORM_BUNDLE_CACHE_SCOPE: EXPECTED_CLOUDFLARE_CACHE_SCOPE,
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: 'false',
    HZY_PLATFORM_SIGNING_KID: 'platform-prod-key',
    HZY_PLATFORM_SIGNING_PUBKEY: '-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=\\n-----END PUBLIC KEY-----',
    HZY_CONSOLE_RUN_MODE: 'prod',
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'false',
    HZY_PLATFORM_RUNTIME_ENABLED: 'true',
    HZY_PLATFORM_HEARTBEAT_ENABLED: 'false',
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false',
    HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'true',
    HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE: 'upsert',
    HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false',
    HZY_CONSOLE_DEV_POLICY_BYPASS: 'false',
    CONSOLE_COLLAB_MODE: 'disabled',
    CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE: 'false',
    CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE: 'false',
    ...overrides
  }
}

function expectedFromEnv(env = {}) {
  return {
    workerName: env.HZY_CONSOLE_WORKER_NAME || 'hzy-console-prod',
    routePattern: env.HZY_CONSOLE_ROUTE_PATTERN || EXPECTED_CLOUDFLARE_CONSOLE_ROUTE,
    routeZone: env.HZY_CONSOLE_ZONE_NAME || EXPECTED_CLOUDFLARE_CONSOLE_ZONE,
    hyperdriveId: env.HZY_CONSOLE_HYPERDRIVE_ID || SAMPLE_HYPERDRIVE_ID,
    platformUrl: trimTrailingSlash(env.HZY_PLATFORM_URL || EXPECTED_CLOUDFLARE_PLATFORM_URL),
    cacheScope: env.HZY_PLATFORM_BUNDLE_CACHE_SCOPE || EXPECTED_CLOUDFLARE_CACHE_SCOPE,
    environment: env.HZY_PLATFORM_ENVIRONMENT || EXPECTED_CLOUDFLARE_ENVIRONMENT,
    publicUrl: trimTrailingSlash(env.HZY_DEPLOYMENT_PUBLIC_URL || EXPECTED_CLOUDFLARE_CONSOLE_PUBLIC_URL),
    dbName: env.DB_NAME || 'hzy_console'
  }
}

function validateGeneratedConfig(config, expected = expectedFromEnv()) {
  const vars = config.vars || {}

  assertEqual(config.name, expected.workerName, 'worker name')
  assertEqual(config.main, '.output/server/index.mjs', 'worker main')
  assertEqual(config.workers_dev, false, 'workers_dev')
  assertEqual(config.hyperdrive?.[0]?.binding, 'HYPERDRIVE', 'hyperdrive binding')
  assertEqual(config.hyperdrive?.[0]?.id, expected.hyperdriveId, 'hyperdrive id')
  assertEqual(config.routes?.[0]?.pattern, expected.routePattern, 'route pattern')
  assertEqual(config.routes?.[0]?.zone_name, expected.routeZone, 'route zone')
  assertEqual(config.routes?.[0]?.custom_domain, true, 'route custom_domain')

  assertEqual(vars.NODE_ENV, 'production', 'NODE_ENV')
  assertEqual(vars.HZY_CLOUDFLARE_RUNTIME, 'true', 'HZY_CLOUDFLARE_RUNTIME')
  assertEqual(vars.HZY_RUNTIME_APP_CONTROL_ENABLED, 'false', 'HZY_RUNTIME_APP_CONTROL_ENABLED')
  assertEqual(vars.HZY_PLATFORM_BUNDLE_CACHE_BACKEND, 'db', 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND')
  assertEqual(vars.HZY_PLATFORM_BUNDLE_CACHE_SCOPE, expected.cacheScope, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE')
  assertEqual(vars.HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK, 'false', 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK')
  assertEqual(vars.HZY_CONSOLE_ACTIVATION_MODE, 'managed-cloud-multitenant', 'HZY_CONSOLE_ACTIVATION_MODE')
  assertEqual(vars.HZY_PLATFORM_ENVIRONMENT, expected.environment, 'HZY_PLATFORM_ENVIRONMENT')
  assertEqual(vars.HZY_CONSOLE_RUN_MODE, 'prod', 'HZY_CONSOLE_RUN_MODE')
  assertEqual(vars.HZY_CONSOLE_TRUST_TENANT_GATEWAY, 'false', 'HZY_CONSOLE_TRUST_TENANT_GATEWAY')
  assertEqual(vars.HZY_PLATFORM_RUNTIME_ENABLED, 'true', 'HZY_PLATFORM_RUNTIME_ENABLED')
  assertEqual(vars.HZY_PLATFORM_HEARTBEAT_ENABLED, 'false', 'HZY_PLATFORM_HEARTBEAT_ENABLED')
  assertEqual(vars.HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT, 'false', 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT')
  assertEqual(vars.HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE, 'true', 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE')
  assertEqual(vars.HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE, 'upsert', 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE')
  assertEqual(vars.HZY_CONSOLE_BACKGROUND_JOBS_ENABLED, 'false', 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED')
  assertEqual(vars.HZY_CONSOLE_DEV_POLICY_BYPASS, 'false', 'HZY_CONSOLE_DEV_POLICY_BYPASS')
  assertEqual(vars.CONSOLE_COLLAB_MODE, 'disabled', 'CONSOLE_COLLAB_MODE')
  assertEqual(vars.CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE, 'false', 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE')
  assertEqual(vars.CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE, 'false', 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE')
  assertEqual(vars.DB_NAME, expected.dbName, 'DB_NAME')
  assertEqual(vars.HZY_DEPLOYMENT_PUBLIC_URL, expected.publicUrl, 'HZY_DEPLOYMENT_PUBLIC_URL')
  assertEqual(vars.HZY_PLATFORM_URL, expected.platformUrl, 'HZY_PLATFORM_URL')
  assertAbsent(vars, 'HZY_PLATFORM_TENANT_CODE', 'managed Cloudflare Console')
  assertAbsent(vars, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'managed Cloudflare Console')

  for (const key of SECRET_VAR_NAMES) {
    assertAbsent(vars, key, 'Cloudflare secrets')
  }
  for (const key of TRIMMED_WRANGLER_VAR_NAMES) {
    assertAbsent(vars, key, 'trimmed Cloudflare vars')
  }
}

function validateRejectsFileCache(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'file'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject HZY_PLATFORM_BUNDLE_CACHE_BACKEND=file')
  }
  if (!result.stderr.includes('HZY_PLATFORM_BUNDLE_CACHE_BACKEND=db')) {
    fail(`Cloudflare renderer rejection message did not explain db cache requirement: ${result.stderr}`)
  }
}

function validateRejectsLegacyFallback(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: 'true'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=true')
  }
  if (!result.stderr.includes('HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false')) {
    fail(`Cloudflare renderer rejection message did not explain scoped cache fallback requirement: ${result.stderr}`)
  }
}

function validateRejectsTenantGatewayTrust(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'true'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject HZY_CONSOLE_TRUST_TENANT_GATEWAY=true')
  }
  if (!result.stderr.includes('HZY_CONSOLE_TRUST_TENANT_GATEWAY=false')) {
    fail(`Cloudflare renderer rejection message did not explain tenant gateway trust requirement: ${result.stderr}`)
  }
}

function validateRejectsInvalidProdFlags(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_PLATFORM_RUNTIME_ENABLED: 'false',
    HZY_CONSOLE_DEV_POLICY_BYPASS: 'true'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject dev/local production runtime flags')
  }
  if (!result.stderr.includes('HZY_PLATFORM_RUNTIME_ENABLED=true') || !result.stderr.includes('HZY_CONSOLE_DEV_POLICY_BYPASS=false')) {
    fail(`Cloudflare renderer rejection message did not explain production runtime flag requirements: ${result.stderr}`)
  }
}

function validateRejectsInvalidProdTarget(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_CONSOLE_ROUTE_PATTERN: 'hzy-test.wiztek.cn',
    HZY_DEPLOYMENT_PUBLIC_URL: 'https://hzy-test.wiztek.cn',
    HZY_PLATFORM_URL: 'https://platform-dev.wiztek.cn',
    HZY_PLATFORM_BUNDLE_CACHE_SCOPE: 'wiztek-test-console',
    DB_NAME: 'hzy_console_test'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject non-production Console prod target settings')
  }
  const output = `${result.stdout}\n${result.stderr}`
  for (const expected of [
    `HZY_CONSOLE_ROUTE_PATTERN=${EXPECTED_CLOUDFLARE_CONSOLE_ROUTE}`,
    `HZY_DEPLOYMENT_PUBLIC_URL=${EXPECTED_CLOUDFLARE_CONSOLE_PUBLIC_URL}`,
    `HZY_PLATFORM_URL=${EXPECTED_CLOUDFLARE_PLATFORM_URL}`,
    `HZY_PLATFORM_BUNDLE_CACHE_SCOPE=${EXPECTED_CLOUDFLARE_CACHE_SCOPE}`,
    'DB_NAME=hzy_console'
  ]) {
    if (!output.includes(expected)) {
      fail(`Cloudflare renderer rejection message did not explain production target requirement ${expected}: ${output}`)
    }
  }
}

function validateRejectsInvalidSharedRuntimeFlags(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    CONSOLE_COLLAB_MODE: 'embedded',
    CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE: 'true',
    CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE: 'true'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject shared-runtime unsafe production flags')
  }
  const output = `${result.stdout}\n${result.stderr}`
  for (const expected of [
    'CONSOLE_COLLAB_MODE=disabled',
    'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE=false',
    'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=false'
  ]) {
    if (!output.includes(expected)) {
      fail(`Cloudflare renderer rejection message did not explain shared-runtime requirement ${expected}: ${output}`)
    }
  }
}

function validateRejectsInvalidAuthClientMode(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE: 'append'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject non-upsert production auth client materialization mode')
  }
  if (!result.stderr.includes('HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE=upsert')) {
    fail(`Cloudflare renderer rejection message did not explain auth client materialization mode requirement: ${result.stderr}`)
  }
}

function validateRejectsPlaceholderValues(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_CONSOLE_HYPERDRIVE_ID: '00000000-0000-0000-0000-000000000000',
    HZY_PLATFORM_SIGNING_KID: '<platform-signing-kid>'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject placeholder production values')
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes('Invalid placeholder value')) {
    fail(`Cloudflare renderer rejection message did not explain placeholder values: ${output}`)
  }
}

function validateRejectsInvalidHyperdriveId(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_CONSOLE_HYPERDRIVE_ID: '4f8bbf15-0e63-4c2d-9c8b-51ac1b0a8c91'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject UUID-style Hyperdrive IDs')
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes('32-character hexadecimal Hyperdrive config id')) {
    fail(`Cloudflare renderer rejection message did not explain Hyperdrive id format: ${output}`)
  }
}

function validateRejectsInvalidSigningPubkey(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_PLATFORM_SIGNING_PUBKEY: 'not-a-public-key'
  }))
  if (result.status === 0) {
    fail('Cloudflare renderer must reject invalid Platform signing pubkey')
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes('HZY_PLATFORM_SIGNING_PUBKEY') || !output.includes('Ed25519')) {
    fail(`Cloudflare renderer rejection message did not explain Platform signing pubkey requirement: ${output}`)
  }
}

function validateNormalizesBooleanAliases(outputPath) {
  const result = runRenderer(sampleEnv(outputPath, {
    HZY_PLATFORM_RUNTIME_ENABLED: '1',
    HZY_PLATFORM_HEARTBEAT_ENABLED: 'no',
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'off',
    HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: '1',
    HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: '0',
    HZY_CONSOLE_DEV_POLICY_BYPASS: '0'
  }))
  if (result.status !== 0) {
    fail(result.stderr.trim() || result.stdout.trim() || 'Cloudflare renderer rejected boolean aliases')
  }

  const vars = parseConfig(outputPath).vars || {}
  assertEqual(vars.HZY_PLATFORM_RUNTIME_ENABLED, 'true', 'normalized HZY_PLATFORM_RUNTIME_ENABLED')
  assertEqual(vars.HZY_PLATFORM_HEARTBEAT_ENABLED, 'false', 'normalized HZY_PLATFORM_HEARTBEAT_ENABLED')
  assertEqual(vars.HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT, 'false', 'normalized HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT')
  assertEqual(vars.HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE, 'true', 'normalized HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE')
  assertEqual(vars.HZY_CONSOLE_BACKGROUND_JOBS_ENABLED, 'false', 'normalized HZY_CONSOLE_BACKGROUND_JOBS_ENABLED')
  assertEqual(vars.HZY_CONSOLE_DEV_POLICY_BYPASS, 'false', 'normalized HZY_CONSOLE_DEV_POLICY_BYPASS')
}

function envForRenderer(outputPath, env, strict) {
  if (!env) return sampleEnv(outputPath)
  if (strict) {
    return {
      ...process.env,
      ...env,
      HZY_CONSOLE_WRANGLER_OUTPUT: outputPath
    }
  }
  return sampleEnv(outputPath, nonEmptyEnv(env))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const tempDir = mkdtempSync(resolve(tmpdir(), 'hzy-console-cf-'))
  try {
    const outputPath = resolve(tempDir, 'wrangler.generated.json')
    validateEnvExample()
    let providedEnv = null
    if (args.envFile) {
      if (!existsSync(args.envFile)) {
        fail(`env file not found: ${args.envFile}`)
      }
      providedEnv = parseEnvFile(args.envFile)
      validateCloudflareEnv(providedEnv, args.envFile, { strict: args.strictEnv })
    }

    const result = runRenderer(envForRenderer(outputPath, providedEnv, args.strictEnv))
    if (result.status !== 0) {
      fail(result.stderr.trim() || result.stdout.trim() || 'Cloudflare renderer failed')
    }

    validateGeneratedConfig(parseConfig(outputPath), expectedFromEnv(providedEnv || undefined))
    validateRejectsFileCache(resolve(tempDir, 'wrangler.invalid.json'))
    validateRejectsLegacyFallback(resolve(tempDir, 'wrangler.legacy-fallback.json'))
    validateRejectsTenantGatewayTrust(resolve(tempDir, 'wrangler.trust-gateway.json'))
    validateRejectsInvalidProdFlags(resolve(tempDir, 'wrangler.invalid-prod-flags.json'))
    validateRejectsInvalidProdTarget(resolve(tempDir, 'wrangler.invalid-prod-target.json'))
    validateRejectsInvalidSharedRuntimeFlags(resolve(tempDir, 'wrangler.invalid-shared-runtime-flags.json'))
    validateRejectsInvalidAuthClientMode(resolve(tempDir, 'wrangler.invalid-auth-client-mode.json'))
    validateRejectsPlaceholderValues(resolve(tempDir, 'wrangler.placeholder-values.json'))
    validateRejectsInvalidHyperdriveId(resolve(tempDir, 'wrangler.invalid-hyperdrive-id.json'))
    validateRejectsInvalidSigningPubkey(resolve(tempDir, 'wrangler.invalid-signing-pubkey.json'))
    validateNormalizesBooleanAliases(resolve(tempDir, 'wrangler.boolean-aliases.json'))
    console.info('[console-cloudflare] passed')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`[console-cloudflare] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
