#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import process from 'node:process'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DEFAULT_FILES = {
  platformProd: 'platform/.env.prod.example',
  platformDev: 'platform/.env.dev.example',
  consoleProd: 'console/.env.prod.example',
  consoleTest: 'console/.env.test.example',
  consoleDev: 'console/.env.dev.example'
}
const CONSOLE_LOCAL_EXAMPLE = 'console/.env.example'

const LABELS = {
  platformProd: 'platform-prod',
  platformDev: 'platform-dev',
  consoleProd: 'console-prod',
  consoleTest: 'console-test',
  consoleDev: 'console-dev'
}

const ARG_TO_KEY = {
  'platform-prod': 'platformProd',
  'platform-prod-env': 'platformProd',
  'platform-dev': 'platformDev',
  'platform-dev-env': 'platformDev',
  'console-prod': 'consoleProd',
  'console-prod-env': 'consoleProd',
  'console-test': 'consoleTest',
  'console-test-env': 'consoleTest',
  'console-dev': 'consoleDev',
  'console-dev-env': 'consoleDev'
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])
const SECRET_KEYS = [
  'HZY_PLATFORM_SIGNING_PRIVATE_KEY',
  'HZY_PLATFORM_RUNTIME_TOKEN',
  'HZY_PLATFORM_LICENSE_TOKEN',
  'HZY_PLATFORM_SIGNING_PUBKEY'
]

function usage() {
  return `
Usage:
  pnpm run validate:runtime-isolation
  pnpm run validate:runtime-isolation -- --strict \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-prod-env console/.env.prod \\
    --console-test-env console/.env.test \\
    --console-dev-env console/.env.dev

Defaults validate the tracked *.example files. The script never prints secret values.
Use --console-prod-cloudflare when console-prod is deployed as a Cloudflare Worker;
the managed multi-tenant Worker must not pin tenant/deployment/runtime-token/license
env, while the unified Cloudflare internal token and other secrets stay in
Worker secrets. Signing kid/pubkey is still validated from the env file.
When --console-prod-cloudflare is used without --console-prod-env, the tracked
console/.env.cloudflare.example is used for console-prod checks.
`
}

function parseArgs(argv) {
  const result = {
    files: { ...DEFAULT_FILES },
    strict: false,
    providedFiles: new Set()
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') {
      continue
    }
    if (item === '--help' || item === '-h') {
      result.help = true
      continue
    }
    if (item === '--strict') {
      result.strict = true
      continue
    }
    if (item === '--console-prod-cloudflare') {
      result.consoleProdCloudflare = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
    const key = ARG_TO_KEY[name]
    if (!key) {
      throw new Error(`unknown option: --${name}`)
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${name}`)
    }
    result.files[key] = value
    result.providedFiles.add(key)
    if (equalsIndex < 0) index += 1
  }

  if (result.consoleProdCloudflare && !result.providedFiles.has('consoleProd')) {
    result.files.consoleProd = 'console/.env.cloudflare.example'
  }

  return result
}

function stripInlineExport(line) {
  return line.startsWith('export ') ? line.slice('export '.length).trimStart() : line
}

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseEnvFile(filePath) {
  const env = {}
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripInlineExport(line.trim())
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = trimmed.slice(0, equalsIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    env[key] = unquote(trimmed.slice(equalsIndex + 1))
  }
  return env
}

function readEnvSet(files) {
  return Object.fromEntries(
    Object.entries(files).map(([key, path]) => {
      const absolute = resolve(process.cwd(), path)
      if (!existsSync(absolute)) {
        throw new Error(`${LABELS[key]} env file not found: ${path}`)
      }
      return [key, {
        path: absolute,
        env: parseEnvFile(absolute)
      }]
    })
  )
}

function readOptionalEnvConfig(path) {
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    return null
  }
  return {
    path: absolute,
    env: parseEnvFile(absolute)
  }
}

function value(config, ...keys) {
  for (const key of keys) {
    const current = String(config.env[key] || '').trim()
    if (current) return current
  }
  return ''
}

function boolValue(raw, fallback = null) {
  const normalized = String(raw || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function envBool(config, key, fallback = null) {
  return boolValue(config.env[key], fallback)
}

function isPlaceholder(raw) {
  const normalized = String(raw || '').trim().toLowerCase()
  if (!normalized) return true
  return normalized.includes('<')
    || normalized.includes('>')
    || normalized.includes('changeme')
    || normalized.includes('change-me')
    || normalized.includes('placeholder')
    || normalized.includes('example')
}

function normalizePemMaterial(raw) {
  const normalized = String(raw || '').trim()
  if (!normalized) return ''
  if (normalized.startsWith('base64:')) {
    return Buffer.from(normalized.slice('base64:'.length), 'base64').toString('utf8').trim()
  }
  if (normalized.startsWith('file://')) {
    return readFileSync(fileURLToPath(normalized), 'utf8').trim()
  }
  if (normalized.startsWith('/')) {
    return readFileSync(normalized, 'utf8').trim()
  }
  return normalized.replace(/\\n/g, '\n')
}

function canonicalPublicKey(publicKey) {
  return publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString()
    .replace(/\s+/g, '')
}

function validateEd25519PrivateKey(config, key, label, reporter) {
  const raw = value(config, key)
  if (!raw || isPlaceholder(raw)) return ''

  try {
    const privateKey = createPrivateKey(normalizePemMaterial(raw))
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      reporter.error(`${label} must be an Ed25519 private key, got ${privateKey.asymmetricKeyType || 'unknown'}`)
      return ''
    }
    return canonicalPublicKey(createPublicKey(privateKey))
  } catch (error) {
    reporter.error(`${label} must be a parseable Ed25519 private key: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

function validateEd25519PublicKey(config, key, label, reporter) {
  const raw = value(config, key)
  if (!raw || isPlaceholder(raw)) return ''

  try {
    const publicKey = createPublicKey(normalizePemMaterial(raw))
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      reporter.error(`${label} must be an Ed25519 public key, got ${publicKey.asymmetricKeyType || 'unknown'}`)
      return ''
    }
    return canonicalPublicKey(publicKey)
  } catch (error) {
    reporter.error(`${label} must be a parseable Ed25519 public key: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

function normalizeUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function normalizePath(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function loopbackPlatformUrls(config) {
  const port = platformPort(config)
  return [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ].map(normalizeUrl)
}

function platformUrl(config) {
  return normalizeUrl(value(config, 'PLATFORM_SERVICE_URL', 'HZY_PLATFORM_URL', 'PLATFORM_BASE_URL'))
}

function consolePlatformUrl(config) {
  return normalizeUrl(value(config, 'HZY_PLATFORM_URL', 'PLATFORM_BASE_URL'))
}

function platformPm2Name(config) {
  return value(config, 'HZY_PLATFORM_PM2_NAME', 'PM2_NAME') || 'hzy-platform-prod'
}

function platformHost(config) {
  return value(config, 'HOST') || '127.0.0.1'
}

function platformPort(config) {
  return value(config, 'PORT') || '3000'
}

function consoleRunMode(config) {
  return value(config, 'HZY_CONSOLE_RUN_MODE', 'CONSOLE_RUN_MODE')
}

function consoleDeploymentCode(config) {
  return value(config, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE')
}

function consolePm2Name(config) {
  return value(config, 'HZY_CONSOLE_PM2_NAME', 'PM2_NAME') || 'hzy-console-prod'
}

function consoleHost(config) {
  return value(config, 'HOST') || '127.0.0.1'
}

function consolePort(config) {
  return value(config, 'PORT') || '3030'
}

function consoleCacheBackend(config) {
  const explicit = value(config, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND').toLowerCase()
  if (explicit) return explicit
  if (envBool(config, 'HZY_CLOUDFLARE_RUNTIME', false) || envBool(config, 'HZY_CLOUDFLARE_BUILD', false)) {
    return 'db'
  }
  return 'file'
}

function consoleCacheDir(config) {
  return normalizePath(value(config, 'HZY_PLATFORM_BUNDLE_CACHE_DIR')
    || (consoleRunMode(config) === 'dev' ? '.data/platform-runtime-dev' : '.data/platform-runtime'))
}

function consoleCacheScope(config) {
  return value(config, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE') || consoleDeploymentCode(config)
}

function consoleCacheLegacyFallback(config) {
  return envBool(config, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK', false)
}

function consoleCollabMode(config) {
  return value(config, 'CONSOLE_COLLAB_MODE', 'HZY_COLLAB_MODE', 'COLLAB_RUNTIME_MODE').toLowerCase()
}

function effectiveConsoleCollabMode(config) {
  const mode = consoleCollabMode(config)
  if (['disabled', 'false', 'off'].includes(mode)) return 'disabled'
  if (['external', 'standalone'].includes(mode)) return 'external'
  if (mode === 'embedded') return 'embedded'
  if (envBool(config, 'HZY_CLOUDFLARE_RUNTIME', false) || envBool(config, 'HZY_CLOUDFLARE_BUILD', false)) {
    return 'disabled'
  }
  return consoleRunMode(config) === 'dev' ? 'disabled' : 'embedded'
}

function consoleCollabPort(config) {
  return value(config, 'COLLAB_PORT') || '3021'
}

function consoleCollabDbName(config) {
  return value(config, 'COLLAB_DB_NAME')
}

function consoleAuthClientMaterializeMode(config) {
  const mode = value(
    config,
    'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE',
    'HZY_AUTH_CLIENT_MATERIALIZE_MODE',
    'AUTH_CLIENT_MATERIALIZE_MODE'
  ).toLowerCase()
  return mode || (consoleRunMode(config) === 'test' ? 'append' : 'upsert')
}

function consoleAuthSigningKeyAutogenerate(config) {
  return envBool(config, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', false)
}

function consoleAuthSigningKeyRotateUnusable(config) {
  return envBool(config, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', false)
}

function consolePublicUrl(config) {
  return normalizeUrl(value(config, 'HZY_DEPLOYMENT_PUBLIC_URL', 'NUXT_PUBLIC_SITE_URL', 'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL'))
}

function consoleOidcRedirectUri(config) {
  return normalizeUrl(value(config, 'SSO_OIDC_REDIRECT_URI', 'OIDC_REDIRECT_URI'))
}

function consoleOidcPostLogoutRedirectUri(config) {
  return normalizeUrl(value(config, 'SSO_OIDC_POST_LOGOUT_REDIRECT_URI', 'OIDC_POST_LOGOUT_REDIRECT_URI'))
}

function startsWithUrl(value, baseUrl) {
  return Boolean(value && baseUrl && (value === baseUrl || value.startsWith(`${baseUrl}/`)))
}

function formatPath(path) {
  return relative(process.cwd(), path) || '.'
}

function makeReporter(strict) {
  const errors = []
  const warnings = []

  function error(message) {
    errors.push(message)
  }

  function warn(message) {
    warnings.push(message)
  }

  function requireEquals(actual, expected, label) {
    if (actual !== expected) {
      error(`${label} must be ${expected}, got ${actual || '<empty>'}`)
    }
  }

  function requireDifferent(left, right, label) {
    if (left && right && left === right) {
      error(`${label} must be different, both are ${left}`)
    }
  }

  function requirePresent(config, keys, label) {
    if (!value(config, ...keys)) {
      error(`${label} is required`)
    }
  }

  function requireBlank(config, key, label) {
    const raw = value(config, key)
    if (raw) {
      error(`${label}; ${key} must stay out of env files`)
    }
  }

  function checkSecret(config, key, label) {
    const raw = value(config, key)
    if (!raw || isPlaceholder(raw)) {
      const message = `${label} is missing or placeholder`
      if (strict) error(message)
      else warn(message)
    }
  }

  function checkDifferentSecret(leftConfig, rightConfig, key, label) {
    const left = value(leftConfig, key)
    const right = value(rightConfig, key)
    if (!left || !right || isPlaceholder(left) || isPlaceholder(right)) return
    if (left === right) {
      error(`${label} must use different secret material`)
    }
  }

  function requireFalse(config, key, label) {
    const raw = value(config, key)
    const parsed = boolValue(raw, null)
    if (!raw) {
      warn(`${label} should explicitly set ${key}=false`)
      return
    }
    if (parsed !== false) {
      error(`${label} must set ${key}=false`)
    }
  }

  function requireTrue(config, key, label) {
    const raw = value(config, key)
    const parsed = boolValue(raw, null)
    if (!raw) {
      warn(`${label} should explicitly set ${key}=true`)
      return
    }
    if (parsed !== true) {
      error(`${label} must set ${key}=true`)
    }
  }

  function forbidTrue(config, key, label) {
    const raw = value(config, key)
    const parsed = boolValue(raw, null)
    if (parsed === true) {
      error(`${label} must not set ${key}=true`)
    }
  }

  return {
    errors,
    warnings,
    error,
    warn,
    requireEquals,
    requireDifferent,
    requirePresent,
    requireBlank,
    checkSecret,
    checkDifferentSecret,
    requireFalse,
    requireTrue,
    forbidTrue
  }
}

function validatePlatform(envs, reporter) {
  const prod = envs.platformProd
  const dev = envs.platformDev
  const prodDb = value(prod, 'DB_NAME')
  const devDb = value(dev, 'DB_NAME')
  const prodUrl = platformUrl(prod)
  const devUrl = platformUrl(dev)
  const prodName = platformPm2Name(prod)
  const devName = platformPm2Name(dev)

  reporter.requireEquals(prodDb, 'hzy_platform', 'platform-prod DB_NAME')
  reporter.requireEquals(devDb, 'hzy_platform_dev', 'platform-dev DB_NAME')
  reporter.requireDifferent(prodDb, devDb, 'Platform DB_NAME')
  reporter.requireDifferent(prodName, devName, 'Platform PM2 process name')
  reporter.requireDifferent(prodUrl, devUrl, 'Platform service URL')
  reporter.requirePresent(prod, ['PLATFORM_SERVICE_URL'], 'platform-prod PLATFORM_SERVICE_URL')
  reporter.requirePresent(dev, ['PLATFORM_SERVICE_URL'], 'platform-dev PLATFORM_SERVICE_URL')

  if (platformHost(prod) === platformHost(dev) && platformPort(prod) === platformPort(dev)) {
    reporter.error(`Platform HOST/PORT must be different for two PM2 instances, both use ${platformHost(prod)}:${platformPort(prod)}`)
  }

  reporter.checkSecret(prod, 'HZY_PLATFORM_SIGNING_PRIVATE_KEY', 'platform-prod signing private key')
  reporter.checkSecret(dev, 'HZY_PLATFORM_SIGNING_PRIVATE_KEY', 'platform-dev signing private key')
  reporter.checkDifferentSecret(prod, dev, 'HZY_PLATFORM_SIGNING_PRIVATE_KEY', 'Platform prod/dev signing keys')

  const prodSigningPublicKey = validateEd25519PrivateKey(prod, 'HZY_PLATFORM_SIGNING_PRIVATE_KEY', 'platform-prod signing private key', reporter)
  const devSigningPublicKey = validateEd25519PrivateKey(dev, 'HZY_PLATFORM_SIGNING_PRIVATE_KEY', 'platform-dev signing private key', reporter)
  if (prodSigningPublicKey && devSigningPublicKey && prodSigningPublicKey === devSigningPublicKey) {
    reporter.error('Platform prod/dev signing private keys must resolve to different Ed25519 public keys')
  }

  return {
    prodSigningPublicKey,
    devSigningPublicKey
  }
}

function validateConsoleProdTest(envs, reporter, options = {}) {
  const prod = envs.consoleProd
  const test = envs.consoleTest
  const prodSecretsExternal = Boolean(options.consoleProdCloudflare)
  const platformKeys = options.platformKeys || {}
  const prodDb = value(prod, 'DB_NAME')
  const testDb = value(test, 'DB_NAME')
  const prodUrl = consolePlatformUrl(prod)
  const testUrl = consolePlatformUrl(test)
  const prodDeployment = consoleDeploymentCode(prod)
  const testDeployment = consoleDeploymentCode(test)
  const prodName = consolePm2Name(prod)
  const testName = consolePm2Name(test)
  const prodPublicUrl = consolePublicUrl(prod)
  const testPublicUrl = consolePublicUrl(test)
  const prodOidcRedirectUri = consoleOidcRedirectUri(prod)
  const testOidcRedirectUri = consoleOidcRedirectUri(test)
  const prodPostLogoutRedirectUri = consoleOidcPostLogoutRedirectUri(prod)
  const testPostLogoutRedirectUri = consoleOidcPostLogoutRedirectUri(test)
  const expectedProdUrl = platformUrl(envs.platformProd)
  const expectedTestUrl = platformUrl(envs.platformDev)

  reporter.requireEquals(prodDb, 'hzy_console', 'console-prod DB_NAME')
  reporter.requireEquals(testDb, 'hzy_console', 'console-test DB_NAME')
  reporter.requireEquals(consoleRunMode(prod), 'prod', 'console-prod HZY_CONSOLE_RUN_MODE')
  reporter.requireEquals(consoleRunMode(test), 'test', 'console-test HZY_CONSOLE_RUN_MODE')
  reporter.requireDifferent(prodUrl, testUrl, 'Console Platform URL')
  reporter.requireDifferent(prodDeployment, testDeployment, 'Console deploymentCode')
  reporter.requireDifferent(prodName, testName, 'Console PM2 process name')
  reporter.requireDifferent(prodPublicUrl, testPublicUrl, 'Console public URL')
  reporter.requireDifferent(prodOidcRedirectUri, testOidcRedirectUri, 'Console OIDC redirect URI')
  reporter.requireDifferent(prodPostLogoutRedirectUri, testPostLogoutRedirectUri, 'Console OIDC post logout redirect URI')
  reporter.requireFalse(prod, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'console-prod')
  reporter.requireFalse(test, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'console-test')
  reporter.requireTrue(prod, 'HZY_PLATFORM_RUNTIME_ENABLED', 'console-prod')
  reporter.requireTrue(test, 'HZY_PLATFORM_RUNTIME_ENABLED', 'console-test')
  if (prodSecretsExternal) {
    reporter.requireEquals(value(prod, 'HZY_CONSOLE_ACTIVATION_MODE'), 'managed-cloud-multitenant', 'console-prod HZY_CONSOLE_ACTIVATION_MODE')
    reporter.requireEquals(value(prod, 'HZY_PLATFORM_ENVIRONMENT'), 'prod', 'console-prod HZY_PLATFORM_ENVIRONMENT')
    reporter.requireEquals(consoleCacheScope(prod), 'managed-cloud-console', 'console-prod HZY_PLATFORM_BUNDLE_CACHE_SCOPE')
    reporter.requireFalse(prod, 'HZY_PLATFORM_HEARTBEAT_ENABLED', 'console-prod')
    reporter.requireFalse(prod, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', 'console-prod')
    reporter.requireFalse(prod, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'console-prod')
  } else {
    reporter.requireTrue(prod, 'HZY_PLATFORM_HEARTBEAT_ENABLED', 'console-prod')
    reporter.requireTrue(prod, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', 'console-prod')
    reporter.requireTrue(prod, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'console-prod')
  }
  reporter.requireTrue(test, 'HZY_PLATFORM_HEARTBEAT_ENABLED', 'console-test')
  reporter.requireTrue(test, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', 'console-test')
  reporter.requireTrue(prod, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE', 'console-prod')
  reporter.requireTrue(test, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE', 'console-test')
  reporter.requireEquals(consoleAuthClientMaterializeMode(prod), 'upsert', 'console-prod HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE')
  reporter.requireEquals(consoleAuthClientMaterializeMode(test), 'append', 'console-test HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE')
  reporter.requireFalse(prod, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', 'console-prod')
  reporter.requireFalse(test, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', 'console-test')
  reporter.requireFalse(prod, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', 'console-prod')
  reporter.requireFalse(test, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', 'console-test')
  reporter.requireTrue(test, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'console-test')
  reporter.forbidTrue(prod, 'HZY_CONSOLE_DEV_POLICY_BYPASS', 'console-prod')
  reporter.forbidTrue(test, 'HZY_CONSOLE_DEV_POLICY_BYPASS', 'console-test')

  if (!prodSecretsExternal && expectedProdUrl && prodUrl && prodUrl !== expectedProdUrl) {
    reporter.error(`console-prod HZY_PLATFORM_URL must match platform-prod PLATFORM_SERVICE_URL (${expectedProdUrl}), got ${prodUrl}`)
  }
  if (expectedTestUrl && testUrl && testUrl !== expectedTestUrl) {
    reporter.error(`console-test HZY_PLATFORM_URL must match platform-dev PLATFORM_SERVICE_URL (${expectedTestUrl}), got ${testUrl}`)
  }
  if (consoleHost(prod) === consoleHost(test) && consolePort(prod) === consolePort(test)) {
    reporter.error(`Console HOST/PORT must be different for prod/test PM2 instances, both use ${consoleHost(prod)}:${consolePort(prod)}`)
  }

  for (const [config, label, secretsExternal, expectedPlatformPublicKey, expectedPlatformLabel] of [
    [prod, 'console-prod', prodSecretsExternal, platformKeys.prodSigningPublicKey, 'platform-prod'],
    [test, 'console-test', false, platformKeys.devSigningPublicKey, 'platform-dev']
  ]) {
    if (secretsExternal) {
      reporter.requireBlank(config, 'HZY_PLATFORM_TENANT_CODE', `${label} must resolve tenant per request`)
      reporter.requireBlank(config, 'HZY_PLATFORM_DEPLOYMENT_CODE', `${label} must resolve deployment per request`)
    } else {
      reporter.requirePresent(config, ['HZY_PLATFORM_TENANT_CODE', 'TENANT_CODE'], `${label} tenantCode`)
      reporter.requirePresent(config, ['HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'], `${label} deploymentCode`)
    }
    reporter.requirePresent(config, ['HZY_PLATFORM_URL', 'PLATFORM_BASE_URL'], `${label} Platform URL`)
    reporter.requirePresent(config, ['HZY_DEPLOYMENT_PUBLIC_URL', 'NUXT_PUBLIC_SITE_URL'], `${label} public URL`)
    reporter.checkSecret(config, 'HZY_PLATFORM_SIGNING_KID', `${label} signing kid`)
    reporter.checkSecret(config, 'HZY_PLATFORM_SIGNING_PUBKEY', `${label} signing pubkey`)
    const consolePlatformPublicKey = validateEd25519PublicKey(config, 'HZY_PLATFORM_SIGNING_PUBKEY', `${label} signing pubkey`, reporter)
    if (consolePlatformPublicKey && expectedPlatformPublicKey && consolePlatformPublicKey !== expectedPlatformPublicKey) {
      reporter.error(`${label} HZY_PLATFORM_SIGNING_PUBKEY must match ${expectedPlatformLabel} signing key`)
    }
    if (secretsExternal) {
      reporter.requireBlank(config, 'HZY_PLATFORM_RUNTIME_TOKEN', `${label} does not use tenant runtime token`)
      reporter.requireBlank(config, 'HZY_PLATFORM_LICENSE_TOKEN', `${label} does not use deployment license token`)
      reporter.requireBlank(config, 'HZY_CLOUDFLARE_INTERNAL_TOKEN', `${label} Cloudflare internal token must be provided as a Worker secret`)
      reporter.requireBlank(config, 'HZY_CONSOLE_PLATFORM_SERVICE_TOKEN', `${label} legacy Platform service token must be provided as a Worker secret when used`)
      reporter.requireBlank(config, 'HZY_TENANT_GATEWAY_INTERNAL_TOKEN', `${label} legacy Tenant Gateway token must be provided as a Worker secret when used`)
    } else {
      reporter.checkSecret(config, 'HZY_PLATFORM_RUNTIME_TOKEN', `${label} runtime token`)
      reporter.checkSecret(config, 'HZY_PLATFORM_LICENSE_TOKEN', `${label} license token`)
    }
  }

  for (const key of SECRET_KEYS) {
    if (prodSecretsExternal && (key === 'HZY_PLATFORM_RUNTIME_TOKEN' || key === 'HZY_PLATFORM_LICENSE_TOKEN')) {
      continue
    }
    reporter.checkDifferentSecret(prod, test, key, `Console prod/test ${key}`)
  }

  const prodBackend = consoleCacheBackend(prod)
  const testBackend = consoleCacheBackend(test)
  if (prodBackend === 'file' && testBackend === 'file') {
    reporter.requireDifferent(consoleCacheDir(prod), consoleCacheDir(test), 'Console prod/test file cache dir')
  }
  if (prodBackend === 'db' && !consoleCacheScope(prod)) {
    reporter.error('console-prod DB cache requires HZY_PLATFORM_BUNDLE_CACHE_SCOPE or HZY_PLATFORM_DEPLOYMENT_CODE')
  }
  if (testBackend === 'db' && !consoleCacheScope(test)) {
    reporter.error('console-test DB cache requires HZY_PLATFORM_BUNDLE_CACHE_SCOPE or HZY_PLATFORM_DEPLOYMENT_CODE')
  }
  if (prodBackend === 'db' && testBackend === 'db') {
    reporter.requireDifferent(consoleCacheScope(prod), consoleCacheScope(test), 'Console prod/test DB cache scope')
  }
  if (consoleCacheLegacyFallback(prod)) {
    reporter.error('console-prod must not enable HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK in shared runtime')
  }
  if (consoleCacheLegacyFallback(test)) {
    reporter.error('console-test must not enable HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK in shared runtime')
  }

  const prodCollabMode = effectiveConsoleCollabMode(prod)
  const testCollabMode = effectiveConsoleCollabMode(test)
  if (testCollabMode === 'embedded' && !consoleCollabMode(test)) {
    reporter.error('console-test must explicitly set CONSOLE_COLLAB_MODE=disabled, external, or embedded with an isolated COLLAB_PORT')
  }
  if (prodCollabMode === 'embedded' && testCollabMode === 'embedded' && consoleCollabPort(prod) === consoleCollabPort(test)) {
    reporter.error(`console-prod and console-test embedded Collab runtimes must use different COLLAB_PORT values, both use ${consoleCollabPort(prod)}`)
  }
  for (const [config, label, mode] of [
    [prod, 'console-prod', prodCollabMode],
    [test, 'console-test', testCollabMode]
  ]) {
    if (mode !== 'embedded') {
      continue
    }

    const collabDbName = consoleCollabDbName(config)
    if (!collabDbName) {
      reporter.error(`${label} embedded Collab requires explicit COLLAB_DB_NAME; use hzy_codocs or an isolated Collab DB`)
    } else if (collabDbName === 'hzy_console') {
      reporter.error(`${label} embedded Collab must not use COLLAB_DB_NAME=hzy_console; use hzy_codocs or an isolated Collab DB`)
    }
  }

  for (const [config, label, publicUrl] of [
    [prod, 'console-prod', prodPublicUrl],
    [test, 'console-test', testPublicUrl]
  ]) {
    const redirectUri = consoleOidcRedirectUri(config)
    const postLogoutRedirectUri = consoleOidcPostLogoutRedirectUri(config)
    if (redirectUri && !startsWithUrl(redirectUri, publicUrl)) {
      reporter.error(`${label} SSO_OIDC_REDIRECT_URI must use its own public URL (${publicUrl}), got ${redirectUri}`)
    }
    if (postLogoutRedirectUri && !startsWithUrl(postLogoutRedirectUri, publicUrl)) {
      reporter.error(`${label} SSO_OIDC_POST_LOGOUT_REDIRECT_URI must use its own public URL (${publicUrl}), got ${postLogoutRedirectUri}`)
    }
  }
}

function validateConsoleDev(envs, reporter) {
  const dev = envs.consoleDev
  const prod = envs.consoleProd
  const test = envs.consoleTest
  const deployment = consoleDeploymentCode(dev)
  const devPlatformUrl = consolePlatformUrl(dev)
  const devPublicUrl = consolePublicUrl(dev)
  const devOidcRedirectUri = consoleOidcRedirectUri(dev)
  const devPostLogoutRedirectUri = consoleOidcPostLogoutRedirectUri(dev)
  const sharedConsolePublicUrls = new Set([
    consolePublicUrl(prod),
    consolePublicUrl(test)
  ].filter(Boolean))
  const prodPlatformUrls = new Set([
    platformUrl(envs.platformProd),
    ...loopbackPlatformUrls(envs.platformProd)
  ].filter(Boolean))

  reporter.requireEquals(consoleRunMode(dev), 'dev', 'console-dev HZY_CONSOLE_RUN_MODE')
  reporter.requireFalse(dev, 'HZY_PLATFORM_RUNTIME_ENABLED', 'console-dev')
  reporter.requireFalse(dev, 'HZY_PLATFORM_HEARTBEAT_ENABLED', 'console-dev')
  reporter.requireFalse(dev, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', 'console-dev')
  reporter.requireFalse(dev, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE', 'console-dev')
  reporter.requireFalse(dev, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'console-dev')
  reporter.requireFalse(dev, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'console-dev')
  reporter.requireFalse(dev, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', 'console-dev')
  reporter.requireFalse(dev, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', 'console-dev')

  const collabMode = consoleCollabMode(dev)
  if (!['disabled', 'false', 'off'].includes(collabMode)) {
    reporter.error(`console-dev CONSOLE_COLLAB_MODE must default to disabled, got ${collabMode || '<empty>'}`)
  }

  if (consoleCacheBackend(dev) !== 'file') {
    reporter.error('console-dev default cache backend must be file')
  }
  if (consoleCacheLegacyFallback(dev)) {
    reporter.error('console-dev must not enable HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK')
  }
  if (consoleCacheDir(dev) === consoleCacheDir(prod) || consoleCacheDir(dev) === consoleCacheDir(test)) {
    reporter.error(`console-dev cache dir must not equal prod/test cache dir: ${consoleCacheDir(dev)}`)
  }
  if (deployment && [consoleDeploymentCode(prod), consoleDeploymentCode(test)].includes(deployment)) {
    reporter.error(`console-dev deploymentCode must not reuse prod/test deploymentCode: ${deployment}`)
  }
  if (devPlatformUrl && prodPlatformUrls.has(devPlatformUrl)) {
    reporter.error(`console-dev HZY_PLATFORM_URL must not point to platform-prod: ${devPlatformUrl}`)
  }
  if (devPublicUrl && sharedConsolePublicUrls.has(devPublicUrl)) {
    reporter.error(`console-dev public URL must not reuse prod/test public URL: ${devPublicUrl}`)
  }
  for (const redirectUri of [devOidcRedirectUri, devPostLogoutRedirectUri].filter(Boolean)) {
    for (const publicUrl of sharedConsolePublicUrls) {
      if (startsWithUrl(redirectUri, publicUrl)) {
        reporter.error(`console-dev OIDC redirect URI must not point to prod/test public URL (${publicUrl}): ${redirectUri}`)
      }
    }
  }
}

function printSummary(envs, reporter) {
  console.info('[runtime-isolation] files:')
  for (const [key, config] of Object.entries(envs)) {
    console.info(`  - ${LABELS[key]}: ${formatPath(config.path)}`)
  }

  console.info('[runtime-isolation] topology:')
  console.info(`  - platform-prod: db=${value(envs.platformProd, 'DB_NAME') || '<empty>'}, url=${platformUrl(envs.platformProd) || '<empty>'}, pm2=${platformPm2Name(envs.platformProd)}, listen=${platformHost(envs.platformProd)}:${platformPort(envs.platformProd)}`)
  console.info(`  - platform-dev: db=${value(envs.platformDev, 'DB_NAME') || '<empty>'}, url=${platformUrl(envs.platformDev) || '<empty>'}, pm2=${platformPm2Name(envs.platformDev)}, listen=${platformHost(envs.platformDev)}:${platformPort(envs.platformDev)}`)
  console.info(`  - console-prod: db=${value(envs.consoleProd, 'DB_NAME') || '<empty>'}, platform=${consolePlatformUrl(envs.consoleProd) || '<empty>'}, deployment=${consoleDeploymentCode(envs.consoleProd) || '<empty>'}, pm2=${consolePm2Name(envs.consoleProd)}, listen=${consoleHost(envs.consoleProd)}:${consolePort(envs.consoleProd)}, cache=${consoleCacheBackend(envs.consoleProd)}:${consoleCacheBackend(envs.consoleProd) === 'db' ? consoleCacheScope(envs.consoleProd) || '<empty>' : consoleCacheDir(envs.consoleProd)}, collab=${effectiveConsoleCollabMode(envs.consoleProd)}, authClients=${consoleAuthClientMaterializeMode(envs.consoleProd)}, authKeyAutogen=${consoleAuthSigningKeyAutogenerate(envs.consoleProd)}, authKeyRotate=${consoleAuthSigningKeyRotateUnusable(envs.consoleProd)}`)
  console.info(`  - console-test: db=${value(envs.consoleTest, 'DB_NAME') || '<empty>'}, platform=${consolePlatformUrl(envs.consoleTest) || '<empty>'}, deployment=${consoleDeploymentCode(envs.consoleTest) || '<empty>'}, pm2=${consolePm2Name(envs.consoleTest)}, listen=${consoleHost(envs.consoleTest)}:${consolePort(envs.consoleTest)}, cache=${consoleCacheBackend(envs.consoleTest)}:${consoleCacheBackend(envs.consoleTest) === 'db' ? consoleCacheScope(envs.consoleTest) || '<empty>' : consoleCacheDir(envs.consoleTest)}, collab=${effectiveConsoleCollabMode(envs.consoleTest)}, authClients=${consoleAuthClientMaterializeMode(envs.consoleTest)}, authKeyAutogen=${consoleAuthSigningKeyAutogenerate(envs.consoleTest)}, authKeyRotate=${consoleAuthSigningKeyRotateUnusable(envs.consoleTest)}`)
  console.info(`  - console-dev: mode=${consoleRunMode(envs.consoleDev) || '<empty>'}, runtime=${value(envs.consoleDev, 'HZY_PLATFORM_RUNTIME_ENABLED') || '<empty>'}, cache=${consoleCacheBackend(envs.consoleDev)}:${consoleCacheDir(envs.consoleDev)}, collab=${consoleCollabMode(envs.consoleDev) || '<empty>'}, authKeyAutogen=${consoleAuthSigningKeyAutogenerate(envs.consoleDev)}, authKeyRotate=${consoleAuthSigningKeyRotateUnusable(envs.consoleDev)}`)

  if (reporter.warnings.length) {
    console.info('[runtime-isolation] warnings:')
    for (const warning of reporter.warnings) {
      console.info(`  - ${warning}`)
    }
  }
}

function validateConsoleLocalExample(envs, reporter, selectedConsoleDevPath) {
  const localExample = readOptionalEnvConfig(CONSOLE_LOCAL_EXAMPLE)
  if (!localExample) {
    return
  }

  if (resolve(selectedConsoleDevPath) === localExample.path) {
    return
  }

  validateConsoleDev({
    ...envs,
    consoleDev: localExample
  }, reporter)
  console.info(`[runtime-isolation] ${CONSOLE_LOCAL_EXAMPLE} passed as safe console-dev defaults`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const envs = readEnvSet(args.files)
  const reporter = makeReporter(args.strict)
  const platformKeys = validatePlatform(envs, reporter)
  validateConsoleProdTest(envs, reporter, {
    consoleProdCloudflare: args.consoleProdCloudflare,
    platformKeys
  })
  validateConsoleDev(envs, reporter)
  validateConsoleLocalExample(envs, reporter, args.files.consoleDev)
  printSummary(envs, reporter)

  if (reporter.errors.length) {
    console.error('[runtime-isolation] failed:')
    for (const error of reporter.errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  console.info('[runtime-isolation] passed')
}

try {
  main()
} catch (error) {
  console.error(`[runtime-isolation] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
