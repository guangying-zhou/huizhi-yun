#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const DEFAULT_FILES = {
  platformProd: 'platform/.env.prod.example',
  platformDev: 'platform/.env.dev.example',
  consoleProd: 'console/.env.prod.example',
  consoleTest: 'console/.env.test.example',
  consoleDev: 'console/.env.dev.example'
}

const ARG_TO_FILE = {
  'platform-prod-env': 'platformProd',
  'platform-dev-env': 'platformDev',
  'console-prod-env': 'consoleProd',
  'console-test-env': 'consoleTest',
  'console-dev-env': 'consoleDev'
}

function usage() {
  return `
Usage:
  pnpm run probe:console-runtime -- --prod-url http://127.0.0.1:3030 --test-url http://127.0.0.1:3031
  pnpm run probe:console-runtime -- --prod-url https://hzy.wiztek.cn --token-env CONSOLE_DIAGNOSTICS_TOKEN
  pnpm run probe:console-runtime -- --prod-url https://hzy.wiztek.cn --test-url https://hzy-test.wiztek.cn \\
    --prod-token-env CONSOLE_PROD_DIAGNOSTICS_TOKEN --test-token-env CONSOLE_TEST_DIAGNOSTICS_TOKEN

The Console diagnostics endpoint only returns non-secret runtime fields. Use loopback URLs on the server, or configure HZY_CONSOLE_DIAGNOSTICS_TOKEN and pass per-target --prod-token-env / --test-token-env / --dev-token-env. Shared --token/--token-env remains supported as a fallback.
`
}

function parseArgs(argv) {
  const args = {
    files: { ...DEFAULT_FILES },
    urls: {},
    token: '',
    tokens: {}
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') {
      continue
    }
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (['prod-url', 'test-url', 'dev-url'].includes(name)) {
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.urls[name.slice(0, -4)] = value
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'token') {
      if (!value || value.startsWith('--')) throw new Error('missing value for --token')
      args.token = value
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'token-env') {
      if (!value || value.startsWith('--')) throw new Error('missing value for --token-env')
      args.token = String(process.env[value] || '').trim()
      if (!args.token) throw new Error(`environment variable is empty: ${value}`)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['prod-token', 'test-token', 'dev-token'].includes(name)) {
      const target = name.slice(0, -'-token'.length)
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.tokens[target] = value
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['prod-token-env', 'test-token-env', 'dev-token-env'].includes(name)) {
      const target = name.slice(0, -'-token-env'.length)
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.tokens[target] = String(process.env[value] || '').trim()
      if (!args.tokens[target]) throw new Error(`environment variable is empty: ${value}`)
      if (equalsIndex < 0) index += 1
      continue
    }

    const fileKey = ARG_TO_FILE[name]
    if (fileKey) {
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.files[fileKey] = value
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
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

function parseEnvFile(path) {
  const env = {}
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    env[trimmed.slice(0, equalsIndex).trim()] = unquote(trimmed.slice(equalsIndex + 1))
  }
  return env
}

function readEnvSet(files) {
  return Object.fromEntries(
    Object.entries(files).map(([key, file]) => {
      const path = resolve(process.cwd(), file)
      if (!existsSync(path)) {
        throw new Error(`env file not found: ${file}`)
      }
      return [key, parseEnvFile(path)]
    })
  )
}

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = String(env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function cacheBackend(env) {
  return String(envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND') || 'file').toLowerCase()
}

function cacheDir(env, runMode) {
  return envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_DIR')
    || (runMode === 'dev' ? '.data/platform-runtime-dev' : '.data/platform-runtime')
}

function cacheScope(env) {
  return envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE')
    || envValue(env, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE')
}

function cacheTable(env) {
  return envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_TABLE') || 'console_runtime_cache'
}

function cacheLegacyFallback(env) {
  return ['1', 'true', 'yes', 'on'].includes(String(envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK')).toLowerCase())
}

function trustTenantGateway(env) {
  return ['1', 'true', 'yes', 'on'].includes(String(envValue(env, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'CONSOLE_TRUST_TENANT_GATEWAY')).toLowerCase())
}

function dbName(env) {
  return envValue(env, 'DB_NAME') || 'hzy_console'
}

function cloudflareRuntime(env) {
  return ['1', 'true', 'yes', 'on'].includes(String(envValue(env, 'HZY_CLOUDFLARE_RUNTIME', 'HZY_CLOUDFLARE_BUILD')).toLowerCase())
}

function boolEnv(env, key, fallback) {
  const raw = String(envValue(env, key)).toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

function effectiveCollabMode(env, runMode) {
  const configured = envValue(env, 'CONSOLE_COLLAB_MODE', 'HZY_COLLAB_MODE', 'COLLAB_RUNTIME_MODE').toLowerCase()
  if (['disabled', 'false', 'off'].includes(configured)) return 'disabled'
  if (['external', 'standalone'].includes(configured)) return 'external'
  if (configured === 'embedded') return 'embedded'
  if (cloudflareRuntime(env) || runMode === 'dev') return 'disabled'
  return 'embedded'
}

function collabPort(env) {
  return envValue(env, 'COLLAB_PORT') || '3021'
}

function collabDbName(env, mode) {
  if (mode !== 'embedded') return ''
  return envValue(env, 'COLLAB_DB_NAME') || 'hzy_codocs'
}

function authClientMaterializeMode(env, runMode) {
  const configured = envValue(
    env,
    'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE',
    'HZY_AUTH_CLIENT_MATERIALIZE_MODE',
    'AUTH_CLIENT_MATERIALIZE_MODE'
  ).toLowerCase()
  if (['append', 'append_redirects', 'redirects_only'].includes(configured)) return 'append'
  if (['upsert', 'full', 'replace'].includes(configured)) return 'upsert'
  return runMode === 'test' ? 'append' : 'upsert'
}

function deploymentPublicUrl(env) {
  return normalizeUrl(envValue(
    env,
    'HZY_DEPLOYMENT_PUBLIC_URL',
    'NUXT_PUBLIC_SITE_URL',
    'HZY_CONSOLE_URL',
    'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL',
    'NUXT_PUBLIC_CONSOLE_URL'
  ))
}

function expectedFor(target, envs) {
  if (target === 'prod') {
    const collabMode = effectiveCollabMode(envs.consoleProd, 'prod')
    const managedCloudMultitenant = envValue(envs.consoleProd, 'HZY_CONSOLE_ACTIVATION_MODE') === 'managed-cloud-multitenant'
    return {
      activationMode: managedCloudMultitenant ? 'managed-cloud-multitenant' : 'standalone',
      runMode: 'prod',
      runtimeEnabled: true,
      databaseName: dbName(envs.consoleProd),
      heartbeatEnabled: boolEnv(envs.consoleProd, 'HZY_PLATFORM_HEARTBEAT_ENABLED', !managedCloudMultitenant),
      bundleRefreshOnBoot: boolEnv(envs.consoleProd, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', !managedCloudMultitenant),
      authClientMaterializeEnabled: true,
      backgroundJobsEnabled: boolEnv(envs.consoleProd, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', !managedCloudMultitenant),
      devPolicyBypassEnabled: false,
      trustTenantGateway: trustTenantGateway(envs.consoleProd),
      platformConfigured: true,
      platformUrl: normalizeUrl(envValue(envs.consoleProd, 'HZY_PLATFORM_URL', 'PLATFORM_BASE_URL') || envValue(envs.platformProd, 'PLATFORM_SERVICE_URL')),
      tenantCode: managedCloudMultitenant ? null : envValue(envs.consoleProd, 'HZY_PLATFORM_TENANT_CODE', 'TENANT_CODE'),
      deploymentCode: managedCloudMultitenant ? null : envValue(envs.consoleProd, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'),
      cacheBackend: cacheBackend(envs.consoleProd),
      cacheDir: cacheDir(envs.consoleProd, 'prod'),
      cacheScope: cacheScope(envs.consoleProd),
      cacheTable: cacheTable(envs.consoleProd),
      cacheLegacyFallback: cacheLegacyFallback(envs.consoleProd),
      publicUrl: deploymentPublicUrl(envs.consoleProd),
      authClientMaterializeMode: authClientMaterializeMode(envs.consoleProd, 'prod'),
      authSigningKeyAutogenerate: boolEnv(envs.consoleProd, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', false),
      authSigningKeyRotateUnusable: boolEnv(envs.consoleProd, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', false),
      collabMode,
      collabPort: collabPort(envs.consoleProd),
      collabDbName: collabDbName(envs.consoleProd, collabMode),
      requiresBundle: !managedCloudMultitenant
    }
  }

  if (target === 'test') {
    const collabMode = effectiveCollabMode(envs.consoleTest, 'test')
    return {
      activationMode: 'standalone',
      runMode: 'test',
      runtimeEnabled: true,
      databaseName: dbName(envs.consoleTest),
      heartbeatEnabled: true,
      bundleRefreshOnBoot: true,
      authClientMaterializeEnabled: true,
      backgroundJobsEnabled: true,
      devPolicyBypassEnabled: false,
      trustTenantGateway: trustTenantGateway(envs.consoleTest),
      platformConfigured: true,
      platformUrl: normalizeUrl(envValue(envs.platformDev, 'PLATFORM_SERVICE_URL')),
      tenantCode: envValue(envs.consoleTest, 'HZY_PLATFORM_TENANT_CODE', 'TENANT_CODE'),
      deploymentCode: envValue(envs.consoleTest, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'),
      cacheBackend: cacheBackend(envs.consoleTest),
      cacheDir: cacheDir(envs.consoleTest, 'test'),
      cacheScope: cacheScope(envs.consoleTest),
      cacheTable: cacheTable(envs.consoleTest),
      cacheLegacyFallback: cacheLegacyFallback(envs.consoleTest),
      publicUrl: deploymentPublicUrl(envs.consoleTest),
      authClientMaterializeMode: authClientMaterializeMode(envs.consoleTest, 'test'),
      authSigningKeyAutogenerate: boolEnv(envs.consoleTest, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', false),
      authSigningKeyRotateUnusable: boolEnv(envs.consoleTest, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', false),
      collabMode,
      collabPort: collabPort(envs.consoleTest),
      collabDbName: collabDbName(envs.consoleTest, collabMode)
    }
  }

  const collabMode = effectiveCollabMode(envs.consoleDev, 'dev')
  return {
    activationMode: 'standalone',
    runMode: 'dev',
    runtimeEnabled: false,
    databaseName: dbName(envs.consoleDev),
    heartbeatEnabled: false,
    bundleRefreshOnBoot: false,
    authClientMaterializeEnabled: false,
    backgroundJobsEnabled: false,
    devPolicyBypassEnabled: boolEnv(envs.consoleDev, 'HZY_CONSOLE_DEV_POLICY_BYPASS', true),
    trustTenantGateway: trustTenantGateway(envs.consoleDev),
    platformConfigured: false,
    platformUrl: null,
    tenantCode: null,
    deploymentCode: null,
    cacheBackend: cacheBackend(envs.consoleDev),
    cacheDir: cacheDir(envs.consoleDev, 'dev'),
    cacheScope: cacheScope(envs.consoleDev),
    cacheTable: cacheTable(envs.consoleDev),
    cacheLegacyFallback: cacheLegacyFallback(envs.consoleDev),
    publicUrl: deploymentPublicUrl(envs.consoleDev),
    authClientMaterializeMode: 'disabled',
    authSigningKeyAutogenerate: boolEnv(envs.consoleDev, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE', false),
    authSigningKeyRotateUnusable: boolEnv(envs.consoleDev, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE', false),
    collabMode,
    collabPort: collabPort(envs.consoleDev),
    collabDbName: collabDbName(envs.consoleDev, collabMode)
  }
}

function diagnosticsUrl(baseUrl) {
  return `${normalizeUrl(baseUrl)}/api/activation/diagnostics`
}

async function fetchDiagnostics(baseUrl, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const response = await fetch(diagnosticsUrl(baseUrl), { headers })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { code: 1, message: text.slice(0, 500) }
  }

  if (!response.ok || payload.code !== 0) {
    throw new Error(`diagnostics request failed (${response.status}): ${payload.message || payload.statusMessage || text.slice(0, 200)}`)
  }

  return payload.data
}

function assertEqual(failures, actual, expected, label) {
  if (expected === null || expected === undefined || expected === '') return
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual ?? '<null>'}`)
  }
}

function validateDiagnostics(target, data, expected) {
  const failures = []
  assertEqual(failures, data.runtime?.activationMode || 'standalone', expected.activationMode, `${target} activationMode`)
  assertEqual(failures, data.runtime?.runMode, expected.runMode, `${target} runMode`)
  assertEqual(failures, data.runtime?.runtimeEnabled, expected.runtimeEnabled, `${target} runtimeEnabled`)
  assertEqual(failures, data.runtime?.heartbeatEnabled, expected.heartbeatEnabled, `${target} heartbeatEnabled`)
  assertEqual(failures, data.runtime?.bundleRefreshOnBoot, expected.bundleRefreshOnBoot, `${target} bundleRefreshOnBoot`)
  assertEqual(failures, data.runtime?.authClientMaterializeEnabled, expected.authClientMaterializeEnabled, `${target} authClientMaterializeEnabled`)
  assertEqual(failures, data.runtime?.backgroundJobsEnabled, expected.backgroundJobsEnabled, `${target} backgroundJobsEnabled`)
  assertEqual(failures, data.runtime?.devPolicyBypassEnabled, expected.devPolicyBypassEnabled, `${target} devPolicyBypassEnabled`)
  assertEqual(failures, data.runtime?.trustTenantGateway, expected.trustTenantGateway, `${target} trustTenantGateway`)
  assertEqual(failures, data.database?.configuredName, expected.databaseName, `${target} database.configuredName`)
  assertEqual(failures, normalizeUrl(data.process?.deploymentPublicUrl), expected.publicUrl, `${target} process.deploymentPublicUrl`)
  assertEqual(failures, data.auth?.clientMaterializeMode, expected.authClientMaterializeMode, `${target} auth.clientMaterializeMode`)
  assertEqual(failures, data.auth?.signingKeyAutogenerate, expected.authSigningKeyAutogenerate, `${target} auth.signingKeyAutogenerate`)
  assertEqual(failures, data.auth?.signingKeyRotateUnusable, expected.authSigningKeyRotateUnusable, `${target} auth.signingKeyRotateUnusable`)
  assertEqual(failures, data.collab?.mode, expected.collabMode, `${target} collab.mode`)
  assertEqual(failures, data.platform?.configured, expected.platformConfigured, `${target} platform.configured`)
  assertEqual(failures, normalizeUrl(data.platform?.baseUrl), expected.platformUrl, `${target} platform.baseUrl`)
  assertEqual(failures, data.platform?.tenantCode, expected.tenantCode, `${target} platform.tenantCode`)
  assertEqual(failures, data.platform?.deploymentCode, expected.deploymentCode, `${target} platform.deploymentCode`)
  assertEqual(failures, data.cache?.backend, expected.cacheBackend, `${target} cache.backend`)

  if (expected.cacheBackend === 'db') {
    assertEqual(failures, data.cache?.scope, expected.cacheScope, `${target} cache.scope`)
    assertEqual(failures, data.cache?.table, expected.cacheTable, `${target} cache.table`)
    assertEqual(failures, data.cache?.legacyFallback, expected.cacheLegacyFallback, `${target} cache.legacyFallback`)
  } else {
    assertEqual(failures, data.cache?.cacheDir, expected.cacheDir, `${target} cache.cacheDir`)
  }

  if (target !== 'dev' && data.platform?.configured !== true) {
    failures.push(`${target} platform config is not loadable: ${data.platform?.error || '<no error>'}`)
  }
  if (target !== 'dev' && data.auth?.signingKey?.currentKeyPresent !== true) {
    failures.push(`${target} auth signing key is missing`)
  }
  if (target !== 'dev' && data.auth?.signingKey?.privateKeyUsable !== true) {
    failures.push(`${target} auth signing private key is not usable: ${data.auth?.signingKey?.error || '<no error>'}`)
  }
  if (target !== 'dev') {
    assertEqual(failures, data.database?.connected, true, `${target} database.connected`)
    assertEqual(failures, data.database?.databaseName, expected.databaseName, `${target} database.databaseName`)
    if (expected.requiresBundle !== false) {
      assertEqual(failures, data.activation?.activated, true, `${target} activation.activated`)
      assertEqual(failures, data.activation?.bundleReady, true, `${target} activation.bundleReady`)
      assertEqual(failures, data.bundle?.ready, true, `${target} bundle.ready`)
      assertEqual(failures, data.bundle?.tenantCode, expected.tenantCode, `${target} bundle.tenantCode`)
      assertEqual(failures, data.bundle?.deploymentCode, expected.deploymentCode, `${target} bundle.deploymentCode`)
      if (!data.bundle?.bundleVersion) {
        failures.push(`${target} bundleVersion is missing`)
      }
      if (!data.bundle?.bundleHash) {
        failures.push(`${target} bundleHash is missing`)
      }
      if (data.bundle?.error) {
        failures.push(`${target} bundle read failed: ${data.bundle.error}`)
      }
    }
  } else if (data.database?.connected === true) {
    assertEqual(failures, data.database?.databaseName, expected.databaseName, `${target} database.databaseName`)
  }

  if (expected.collabMode === 'embedded') {
    assertEqual(failures, data.collab?.status, 'running', `${target} collab.status`)
    assertEqual(failures, String(data.collab?.runtime?.port || ''), String(expected.collabPort || ''), `${target} collab.runtime.port`)
    assertEqual(failures, data.collab?.runtime?.database?.name, expected.collabDbName, `${target} collab.runtime.database.name`)
  } else if (expected.collabMode === 'external') {
    assertEqual(failures, data.collab?.status, 'external', `${target} collab.status`)
  } else if (expected.collabMode === 'disabled') {
    assertEqual(failures, data.collab?.status, 'disabled', `${target} collab.status`)
  }

  return failures
}

async function probeTarget(target, baseUrl, token, expected) {
  const data = await fetchDiagnostics(baseUrl, token)
  const failures = validateDiagnostics(target, data, expected)
  console.info(`[console-runtime] ${target}: url=${normalizeUrl(baseUrl)}, runMode=${data.runtime?.runMode}, runtime=${data.runtime?.runtimeEnabled ? 'enabled' : 'disabled'}, db=${data.database?.connected ? data.database?.databaseName : `${data.database?.configuredName || '<empty>'} (not connected)`}, publicUrl=${data.process?.deploymentPublicUrl || '<empty>'}, platform=${data.platform?.baseUrl || '<disabled>'}, deployment=${data.platform?.deploymentCode || '<none>'}, cache=${data.cache?.backend}:${data.cache?.backend === 'db' ? data.cache?.scope || '<none>' : data.cache?.cacheDir || '<none>'}, collab=${data.collab?.mode || '<unknown>'}/${data.collab?.status || '<unknown>'}, authClients=${data.auth?.clientMaterializeMode || '<unknown>'}, authKey=${data.auth?.signingKey?.kid || '<none>'}/${data.auth?.signingKey?.privateKeyUsable ? 'usable' : 'unusable'}, authKeyAutogen=${data.auth?.signingKeyAutogenerate}, authKeyRotate=${data.auth?.signingKeyRotateUnusable}, bundle=${data.bundle?.bundleVersion || '<none>'}`)

  if (failures.length) {
    throw new Error(failures.join('\n  - '))
  }

  return data
}

function validatePair(results) {
  const prod = results.prod
  const test = results.test
  if (!prod || !test) return

  const failures = []
  if (prod.platform?.deploymentCode && prod.platform.deploymentCode === test.platform?.deploymentCode) {
    failures.push(`console-prod and console-test must use different deploymentCode, both use ${prod.platform.deploymentCode}`)
  }
  if (prod.platform?.baseUrl && normalizeUrl(prod.platform.baseUrl) === normalizeUrl(test.platform?.baseUrl)) {
    failures.push(`console-prod and console-test must use different Platform baseUrl, both use ${prod.platform.baseUrl}`)
  }
  if (prod.platform?.signingKid && prod.platform.signingKid === test.platform?.signingKid) {
    failures.push(`console-prod and console-test must use different Platform signing kid, both use ${prod.platform.signingKid}`)
  }
  if (prod.process?.deploymentPublicUrl && normalizeUrl(prod.process.deploymentPublicUrl) === normalizeUrl(test.process?.deploymentPublicUrl)) {
    failures.push(`console-prod and console-test must use different public URL, both use ${prod.process.deploymentPublicUrl}`)
  }
  if (prod.cache?.backend === 'db' && test.cache?.backend === 'db' && prod.cache?.scope === test.cache?.scope) {
    failures.push(`console-prod and console-test DB cache scopes must differ, both use ${prod.cache.scope}`)
  }
  if (prod.cache?.backend === 'file' && test.cache?.backend === 'file' && prod.cache?.cacheDir === test.cache?.cacheDir) {
    failures.push(`console-prod and console-test file cache dirs must differ, both use ${prod.cache.cacheDir}`)
  }
  if (prod.bundle?.bundleHash && prod.bundle.bundleHash === test.bundle?.bundleHash) {
    failures.push(`console-prod and console-test policy bundle hashes must differ, both use ${prod.bundle.bundleHash}`)
  }

  if (failures.length) {
    throw new Error(failures.join('\n  - '))
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const targets = Object.entries(args.urls)
  if (!targets.length) {
    throw new Error('at least one of --prod-url, --test-url or --dev-url is required')
  }

  const envs = readEnvSet(args.files)
  const results = {}
  for (const [target, url] of targets) {
    results[target] = await probeTarget(target, url, args.tokens[target] || args.token, expectedFor(target, envs))
  }
  validatePair(results)
  console.info('[console-runtime] passed')
}

main().catch((error) => {
  console.error(`[console-runtime] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
