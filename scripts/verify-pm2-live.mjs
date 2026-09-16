#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import process from 'node:process'

const DEFAULT_FILES = {
  platformProd: 'platform/.env.prod.example',
  platformDev: 'platform/.env.dev.example',
  consoleProd: 'console/.env.prod.example',
  consoleTest: 'console/.env.test.example'
}

const FILE_OPTIONS = {
  'platform-prod-env': 'platformProd',
  'platform-dev-env': 'platformDev',
  'console-prod-env': 'consoleProd',
  'console-test-env': 'consoleTest'
}

function usage() {
  return `
Usage:
  pnpm run verify:pm2-live -- \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-prod-env console/.env.prod \\
    --console-test-env console/.env.test

  pnpm run verify:pm2-live -- --console-prod-cloudflare \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-test-env console/.env.test

  pnpm run verify:pm2-live -- --pm2-jlist-file /tmp/pm2-jlist.json

Reads pm2 jlist and verifies live PM2 process names, status, ports, DB names,
Platform URLs, Console cache scope/fallback, Tenant Gateway trust, Collab mode
and release workdirs without printing secrets.
`
}

function parseArgs(argv) {
  const args = {
    files: { ...DEFAULT_FILES },
    consoleProdCloudflare: false,
    allowSharedCwd: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--console-prod-cloudflare') {
      args.consoleProdCloudflare = true
      continue
    }
    if (item === '--allow-shared-cwd') {
      args.allowSharedCwd = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
    if (name === 'pm2-jlist-file') {
      args.pm2JlistFile = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    const fileKey = FILE_OPTIONS[name]
    if (!fileKey) {
      throw new Error(`unknown option: --${name}`)
    }
    args.files[fileKey] = requiredValue(name, value)
    if (equalsIndex < 0) index += 1
  }

  return args
}

function requiredValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for --${name}`)
  }
  return value
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
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    throw new Error(`env file not found: ${path}`)
  }

  const env = {}
  const raw = readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    env[trimmed.slice(0, equalsIndex).trim()] = unquote(trimmed.slice(equalsIndex + 1))
  }
  return env
}

function readEnvSet(files, keys = Object.keys(files)) {
  return Object.fromEntries(
    keys.map(key => [key, parseEnvFile(files[key])])
  )
}

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = String(env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function formatPath(path) {
  const normalized = normalizePath(path)
  const relativePath = relative(process.cwd(), normalized)
  return relativePath && !relativePath.startsWith('..') ? relativePath : normalized
}

function expectedScenarios(envs, options) {
  const scenarios = [
    {
      key: 'platformProd',
      label: 'platform-prod',
      group: 'platform',
      expected: {
        name: envValue(envs.platformProd, 'HZY_PLATFORM_PM2_NAME', 'PM2_NAME') || 'hzy-platform-prod',
        host: envValue(envs.platformProd, 'HOST', 'NITRO_HOST') || '127.0.0.1',
        port: envValue(envs.platformProd, 'PORT', 'NITRO_PORT') || '3010',
        dbName: envValue(envs.platformProd, 'DB_NAME'),
        platformServiceUrl: envValue(envs.platformProd, 'PLATFORM_SERVICE_URL'),
        platformStage: envValue(envs.platformProd, 'NUXT_PUBLIC_PLATFORM_STAGE')
      }
    },
    {
      key: 'platformDev',
      label: 'platform-dev',
      group: 'platform',
      expected: {
        name: envValue(envs.platformDev, 'HZY_PLATFORM_PM2_NAME', 'PM2_NAME') || 'hzy-platform-dev',
        host: envValue(envs.platformDev, 'HOST', 'NITRO_HOST') || '127.0.0.1',
        port: envValue(envs.platformDev, 'PORT', 'NITRO_PORT') || '3011',
        dbName: envValue(envs.platformDev, 'DB_NAME'),
        platformServiceUrl: envValue(envs.platformDev, 'PLATFORM_SERVICE_URL'),
        platformStage: envValue(envs.platformDev, 'NUXT_PUBLIC_PLATFORM_STAGE')
      }
    }
  ]

  if (!options.consoleProdCloudflare) {
    scenarios.push({
      key: 'consoleProd',
      label: 'console-prod',
      group: 'console',
      expected: {
        name: envValue(envs.consoleProd, 'HZY_CONSOLE_PM2_NAME', 'PM2_NAME') || 'hzy-console-prod',
        host: envValue(envs.consoleProd, 'HOST', 'NITRO_HOST') || '127.0.0.1',
        port: envValue(envs.consoleProd, 'PORT', 'NITRO_PORT') || '3030',
        dbName: envValue(envs.consoleProd, 'DB_NAME'),
        runMode: envValue(envs.consoleProd, 'HZY_CONSOLE_RUN_MODE', 'CONSOLE_RUN_MODE'),
        platformUrl: envValue(envs.consoleProd, 'HZY_PLATFORM_URL', 'PLATFORM_BASE_URL'),
        deploymentCode: envValue(envs.consoleProd, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'),
        cacheBackend: envValue(envs.consoleProd, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND') || 'file',
        cacheDir: envValue(envs.consoleProd, 'HZY_PLATFORM_BUNDLE_CACHE_DIR'),
        cacheScope: envValue(envs.consoleProd, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE') || envValue(envs.consoleProd, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'),
        cacheLegacyFallback: envValue(envs.consoleProd, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK') || 'false',
        trustTenantGateway: envValue(envs.consoleProd, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'CONSOLE_TRUST_TENANT_GATEWAY') || 'false',
        collabMode: envValue(envs.consoleProd, 'CONSOLE_COLLAB_MODE', 'HZY_COLLAB_MODE', 'COLLAB_RUNTIME_MODE') || 'embedded',
        collabPort: envValue(envs.consoleProd, 'COLLAB_PORT'),
        collabDbName: envValue(envs.consoleProd, 'COLLAB_DB_NAME'),
        runtimeEnabled: envValue(envs.consoleProd, 'HZY_PLATFORM_RUNTIME_ENABLED') || 'true',
        heartbeatEnabled: envValue(envs.consoleProd, 'HZY_PLATFORM_HEARTBEAT_ENABLED') || 'true',
        bundleRefreshOnBoot: envValue(envs.consoleProd, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT') || 'true',
        authClientMaterialize: envValue(envs.consoleProd, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE') || 'true',
        authClientMaterializeMode: envValue(envs.consoleProd, 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE', 'HZY_AUTH_CLIENT_MATERIALIZE_MODE', 'AUTH_CLIENT_MATERIALIZE_MODE') || 'upsert',
        authSigningKeyAutogenerate: envValue(envs.consoleProd, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE') || 'false',
        authSigningKeyRotateUnusable: envValue(envs.consoleProd, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE') || 'false',
        backgroundJobsEnabled: envValue(envs.consoleProd, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED') || 'true',
        devPolicyBypass: envValue(envs.consoleProd, 'HZY_CONSOLE_DEV_POLICY_BYPASS') || 'false'
      }
    })
  }

  scenarios.push({
    key: 'consoleTest',
    label: 'console-test',
    group: 'console',
    expected: {
      name: envValue(envs.consoleTest, 'HZY_CONSOLE_PM2_NAME', 'PM2_NAME') || 'hzy-console-test',
      host: envValue(envs.consoleTest, 'HOST', 'NITRO_HOST') || '127.0.0.1',
      port: envValue(envs.consoleTest, 'PORT', 'NITRO_PORT') || '3031',
      dbName: envValue(envs.consoleTest, 'DB_NAME'),
      runMode: envValue(envs.consoleTest, 'HZY_CONSOLE_RUN_MODE', 'CONSOLE_RUN_MODE'),
      platformUrl: envValue(envs.consoleTest, 'HZY_PLATFORM_URL', 'PLATFORM_BASE_URL'),
      deploymentCode: envValue(envs.consoleTest, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'),
      cacheBackend: envValue(envs.consoleTest, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND') || 'file',
      cacheDir: envValue(envs.consoleTest, 'HZY_PLATFORM_BUNDLE_CACHE_DIR'),
      cacheScope: envValue(envs.consoleTest, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE') || envValue(envs.consoleTest, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE'),
      cacheLegacyFallback: envValue(envs.consoleTest, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK') || 'false',
      trustTenantGateway: envValue(envs.consoleTest, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'CONSOLE_TRUST_TENANT_GATEWAY') || 'false',
      collabMode: envValue(envs.consoleTest, 'CONSOLE_COLLAB_MODE', 'HZY_COLLAB_MODE', 'COLLAB_RUNTIME_MODE') || 'disabled',
      collabPort: envValue(envs.consoleTest, 'COLLAB_PORT'),
      collabDbName: envValue(envs.consoleTest, 'COLLAB_DB_NAME'),
      runtimeEnabled: envValue(envs.consoleTest, 'HZY_PLATFORM_RUNTIME_ENABLED') || 'true',
      heartbeatEnabled: envValue(envs.consoleTest, 'HZY_PLATFORM_HEARTBEAT_ENABLED') || 'true',
      bundleRefreshOnBoot: envValue(envs.consoleTest, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT') || 'true',
      authClientMaterialize: envValue(envs.consoleTest, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE') || 'true',
      authClientMaterializeMode: envValue(envs.consoleTest, 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE', 'HZY_AUTH_CLIENT_MATERIALIZE_MODE', 'AUTH_CLIENT_MATERIALIZE_MODE') || 'append',
      authSigningKeyAutogenerate: envValue(envs.consoleTest, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE') || 'false',
      authSigningKeyRotateUnusable: envValue(envs.consoleTest, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE') || 'false',
      backgroundJobsEnabled: envValue(envs.consoleTest, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED') || 'true',
      devPolicyBypass: envValue(envs.consoleTest, 'HZY_CONSOLE_DEV_POLICY_BYPASS') || 'false'
    }
  })

  return scenarios
}

function pm2Value(processInfo, key) {
  return String(processInfo?.pm2_env?.[key] ?? processInfo?.[key] ?? '')
}

function processCwd(processInfo) {
  return normalizePath(pm2Value(processInfo, 'pm_cwd') || processInfo?.pm2_env?.cwd || processInfo?.pm_cwd)
}

function processExecPath(processInfo) {
  return normalizePath(pm2Value(processInfo, 'pm_exec_path') || processInfo?.pm_exec_path)
}

function assertEqual(errors, label, actual, expected, description) {
  if (!expected) return
  if (String(actual ?? '') !== String(expected)) {
    errors.push(`${label} ${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function loadPm2List(path) {
  if (path) {
    const absolute = resolve(process.cwd(), path)
    if (!existsSync(absolute)) {
      throw new Error(`pm2 jlist fixture not found: ${path}`)
    }
    try {
      return JSON.parse(readFileSync(absolute, 'utf8'))
    } catch (error) {
      throw new Error(`pm2 jlist fixture did not contain valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const result = spawnSync('pm2', ['jlist'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.error) {
    throw new Error(`pm2 jlist failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`pm2 jlist failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`}`)
  }

  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`pm2 jlist did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function findProcess(pm2List, name) {
  return pm2List.find(item => item?.name === name)
}

function consoleProdPm2Names(args) {
  const names = new Set(['hzy-console-prod'])
  const consoleProdEnvPath = args.files.consoleProd
  if (consoleProdEnvPath && existsSync(resolve(process.cwd(), consoleProdEnvPath))) {
    const env = parseEnvFile(consoleProdEnvPath)
    const configuredName = envValue(env, 'HZY_CONSOLE_PM2_NAME', 'PM2_NAME')
    if (configuredName) names.add(configuredName)
  }
  return [...names]
}

function consoleProdPm2Reason(processInfo, forbiddenNames) {
  const name = String(processInfo?.name || '')
  if (forbiddenNames.has(name)) return `name=${name}`

  const cwd = processCwd(processInfo)
  const execPath = processExecPath(processInfo)
  if (cwd.includes('/console-prod') || execPath.includes('/console-prod/')) {
    return `release=${cwd || execPath}`
  }

  const runMode = pm2Value(processInfo, 'HZY_CONSOLE_RUN_MODE') || pm2Value(processInfo, 'CONSOLE_RUN_MODE')
  const deploymentCode = pm2Value(processInfo, 'HZY_PLATFORM_DEPLOYMENT_CODE') || pm2Value(processInfo, 'DEPLOYMENT_CODE')
  const publicUrl = pm2Value(processInfo, 'HZY_DEPLOYMENT_PUBLIC_URL') || pm2Value(processInfo, 'NUXT_PUBLIC_SITE_URL')
  const platformUrl = pm2Value(processInfo, 'HZY_PLATFORM_URL') || pm2Value(processInfo, 'PLATFORM_BASE_URL')
  const dbName = pm2Value(processInfo, 'DB_NAME')
  const port = pm2Value(processInfo, 'PORT') || pm2Value(processInfo, 'NITRO_PORT')

  if (runMode === 'prod' && deploymentCode === 'huizhi-console') {
    return 'runMode=prod deployment=huizhi-console'
  }
  if (runMode === 'prod' && publicUrl === 'https://console.huizhi.yun') {
    return 'runMode=prod publicUrl=https://console.huizhi.yun'
  }
  if (runMode === 'prod' && platformUrl === 'https://huizhi.yun' && dbName === 'hzy_console') {
    return 'runMode=prod platform=https://huizhi.yun db=hzy_console'
  }
  if (port === '3030' && dbName === 'hzy_console' && deploymentCode === 'huizhi-console') {
    return 'listen=3030 db=hzy_console deployment=huizhi-console'
  }

  return ''
}

function assertNoConsoleProdPm2Process(pm2List, args) {
  if (!args.consoleProdCloudflare) return

  const forbiddenNames = new Set(consoleProdPm2Names(args))
  const matches = pm2List
    .map(item => ({ item, reason: consoleProdPm2Reason(item, forbiddenNames) }))
    .filter(match => match.reason)
    .map(({ item, reason }) => `${item.name}:${pm2Value(item, 'status') || 'unknown'} (${reason})`)

  if (matches.length) {
    throw new Error(
      `console-prod PM2 process must not exist when --console-prod-cloudflare is used: ${matches.join(', ')}`
    )
  }
}

function validateProcess(pm2List, scenario) {
  const errors = []
  const expected = scenario.expected
  const processInfo = findProcess(pm2List, expected.name)
  if (!processInfo) {
    throw new Error(`${scenario.label} PM2 process not found: ${expected.name}`)
  }

  const status = pm2Value(processInfo, 'status')
  assertEqual(errors, scenario.label, status, 'online', 'status')
  assertEqual(errors, scenario.label, pm2Value(processInfo, 'HOST'), expected.host, 'HOST')
  assertEqual(errors, scenario.label, pm2Value(processInfo, 'PORT'), expected.port, 'PORT')
  assertEqual(errors, scenario.label, pm2Value(processInfo, 'NITRO_HOST'), expected.host, 'NITRO_HOST')
  assertEqual(errors, scenario.label, pm2Value(processInfo, 'NITRO_PORT'), expected.port, 'NITRO_PORT')
  assertEqual(errors, scenario.label, pm2Value(processInfo, 'DB_NAME'), expected.dbName, 'DB_NAME')

  if (!processExecPath(processInfo).endsWith('.output/server/index.mjs')) {
    errors.push(`${scenario.label} script must end with .output/server/index.mjs, got ${processExecPath(processInfo) || '<empty>'}`)
  }

  if (scenario.group === 'platform') {
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'PLATFORM_SERVICE_URL'), expected.platformServiceUrl, 'PLATFORM_SERVICE_URL')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'NUXT_PUBLIC_PLATFORM_STAGE'), expected.platformStage, 'NUXT_PUBLIC_PLATFORM_STAGE')
  }

  if (scenario.group === 'console') {
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_CONSOLE_RUN_MODE'), expected.runMode, 'HZY_CONSOLE_RUN_MODE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_URL'), expected.platformUrl, 'HZY_PLATFORM_URL')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_DEPLOYMENT_CODE'), expected.deploymentCode, 'HZY_PLATFORM_DEPLOYMENT_CODE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND'), expected.cacheBackend, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_BUNDLE_CACHE_DIR'), expected.cacheDir, 'HZY_PLATFORM_BUNDLE_CACHE_DIR')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE'), expected.cacheScope, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK'), expected.cacheLegacyFallback, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY'), expected.trustTenantGateway, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'CONSOLE_COLLAB_MODE'), expected.collabMode, 'CONSOLE_COLLAB_MODE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'COLLAB_PORT'), expected.collabPort, 'COLLAB_PORT')
    if (expected.collabMode === 'embedded') {
      if (!pm2Value(processInfo, 'COLLAB_DB_NAME')) {
        errors.push(`${scenario.label} COLLAB_DB_NAME: embedded Collab requires an explicit isolated DB name`)
      } else if (pm2Value(processInfo, 'COLLAB_DB_NAME') === 'hzy_console') {
        errors.push(`${scenario.label} COLLAB_DB_NAME: embedded Collab must not use hzy_console`)
      }
      assertEqual(errors, scenario.label, pm2Value(processInfo, 'COLLAB_DB_NAME'), expected.collabDbName, 'COLLAB_DB_NAME')
    }
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_RUNTIME_ENABLED'), expected.runtimeEnabled, 'HZY_PLATFORM_RUNTIME_ENABLED')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_HEARTBEAT_ENABLED'), expected.heartbeatEnabled, 'HZY_PLATFORM_HEARTBEAT_ENABLED')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT'), expected.bundleRefreshOnBoot, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE'), expected.authClientMaterialize, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE'), expected.authClientMaterializeMode, 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE'), expected.authSigningKeyAutogenerate, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE'), expected.authSigningKeyRotateUnusable, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED'), expected.backgroundJobsEnabled, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED')
    assertEqual(errors, scenario.label, pm2Value(processInfo, 'HZY_CONSOLE_DEV_POLICY_BYPASS'), expected.devPolicyBypass, 'HZY_CONSOLE_DEV_POLICY_BYPASS')
  }

  if (errors.length) {
    throw new Error(errors.join('\n'))
  }

  console.info(`[pm2-live] ${scenario.label} passed (${expected.name}, cwd=${formatPath(processCwd(processInfo))}, listen=${expected.host}:${expected.port})`)
  return {
    label: scenario.label,
    group: scenario.group,
    name: expected.name,
    cwd: processCwd(processInfo),
    listen: `${expected.host}:${expected.port}`
  }
}

function validateNoCollisions(results, allowSharedCwd) {
  const errors = []
  const names = new Map()
  const listeners = new Map()

  for (const result of results) {
    if (names.has(result.name)) {
      errors.push(`PM2 process name collision: ${result.name} used by ${names.get(result.name)} and ${result.label}`)
    }
    names.set(result.name, result.label)

    if (listeners.has(result.listen)) {
      errors.push(`PM2 listener collision: ${result.listen} used by ${listeners.get(result.listen)} and ${result.label}`)
    }
    listeners.set(result.listen, result.label)
  }

  if (!allowSharedCwd) {
    for (const group of ['platform', 'console']) {
      const grouped = results.filter(result => result.group === group)
      if (grouped.length < 2) continue
      const cwdSet = new Set(grouped.map(result => result.cwd).filter(Boolean))
      if (cwdSet.size < grouped.length) {
        errors.push(`${group} PM2 processes must use separate release workdirs; got ${grouped.map(result => `${result.label}:${formatPath(result.cwd)}`).join(', ')}`)
      }
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const requiredEnvKeys = args.consoleProdCloudflare
    ? ['platformProd', 'platformDev', 'consoleTest']
    : ['platformProd', 'platformDev', 'consoleProd', 'consoleTest']
  const envs = readEnvSet(args.files, requiredEnvKeys)
  const scenarios = expectedScenarios(envs, args)
  const pm2List = loadPm2List(args.pm2JlistFile)
  assertNoConsoleProdPm2Process(pm2List, args)
  const results = scenarios.map(scenario => validateProcess(pm2List, scenario))
  validateNoCollisions(results, args.allowSharedCwd)
  console.info('[pm2-live] passed')
}

try {
  main()
} catch (error) {
  console.error(`[pm2-live] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
