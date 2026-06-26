#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import process from 'node:process'

const DEFAULT_FILES = {
  platformProd: 'platform/.env.prod.example',
  platformDev: 'platform/.env.dev.example',
  consoleProd: 'console/.env.prod.example',
  consoleTest: 'console/.env.test.example'
}

const ARG_TO_KEY = {
  'platform-prod-env': 'platformProd',
  'platform-dev-env': 'platformDev',
  'console-prod-env': 'consoleProd',
  'console-test-env': 'consoleTest'
}

const SCENARIOS = [
  {
    key: 'platformProd',
    label: 'platform-prod',
    moduleDir: 'platform',
    envVar: 'HZY_PLATFORM_ENV_FILE',
    clearEnv: ['HZY_PLATFORM_PM2_NAME', 'HZY_PLATFORM_HOST', 'HZY_PLATFORM_PORT'],
    expected: {
      name: 'hzy-platform-prod',
      host: '127.0.0.1',
      port: '3010',
      dbName: 'hzy_platform',
      platformServiceUrl: 'https://platform.wiztek.cn',
      platformStage: 'production'
    }
  },
  {
    key: 'platformDev',
    label: 'platform-dev',
    moduleDir: 'platform',
    envVar: 'HZY_PLATFORM_ENV_FILE',
    clearEnv: ['HZY_PLATFORM_PM2_NAME', 'HZY_PLATFORM_HOST', 'HZY_PLATFORM_PORT'],
    expected: {
      name: 'hzy-platform-dev',
      host: '127.0.0.1',
      port: '3011',
      dbName: 'hzy_platform_dev',
      platformServiceUrl: 'https://platform-dev.wiztek.cn',
      platformStage: 'test'
    }
  },
  {
    key: 'consoleProd',
    label: 'console-prod',
    moduleDir: 'console',
    envVar: 'HZY_CONSOLE_ENV_FILE',
    clearEnv: ['HZY_CONSOLE_PM2_NAME', 'HZY_CONSOLE_HOST', 'HZY_CONSOLE_PORT'],
    expected: {
      name: 'hzy-console-prod',
      host: '127.0.0.1',
      port: '3030',
      dbName: 'hzy_console',
      consoleRunMode: 'prod',
      platformUrl: 'https://platform.wiztek.cn',
      deploymentCode: 'wiztek-console',
      cacheBackend: 'file',
      cacheDir: '.data/platform-runtime',
      cacheScope: 'wiztek-console',
      cacheLegacyFallback: 'false',
      trustTenantGateway: 'false',
      collabMode: 'embedded',
      collabPort: '3021',
      collabDbName: 'hzy_codocs',
      runtimeEnabled: 'true',
      heartbeatEnabled: 'true',
      bundleRefreshOnBoot: 'true',
      authClientMaterialize: 'true',
      authClientMaterializeMode: 'upsert',
      authSigningKeyAutogenerate: 'false',
      authSigningKeyRotateUnusable: 'false',
      backgroundJobsEnabled: 'true',
      devPolicyBypass: 'false'
    }
  },
  {
    key: 'consoleTest',
    label: 'console-test',
    moduleDir: 'console',
    envVar: 'HZY_CONSOLE_ENV_FILE',
    clearEnv: ['HZY_CONSOLE_PM2_NAME', 'HZY_CONSOLE_HOST', 'HZY_CONSOLE_PORT'],
    expected: {
      name: 'hzy-console-test',
      host: '127.0.0.1',
      port: '3031',
      dbName: 'hzy_console',
      consoleRunMode: 'test',
      platformUrl: 'https://platform-dev.wiztek.cn',
      deploymentCode: 'wiztek-test-console',
      cacheBackend: 'file',
      cacheDir: '.data/platform-runtime-test',
      cacheScope: 'wiztek-test-console',
      cacheLegacyFallback: 'false',
      trustTenantGateway: 'false',
      collabMode: 'disabled',
      runtimeEnabled: 'true',
      heartbeatEnabled: 'true',
      bundleRefreshOnBoot: 'true',
      authClientMaterialize: 'true',
      authClientMaterializeMode: 'append',
      authSigningKeyAutogenerate: 'false',
      authSigningKeyRotateUnusable: 'false',
      backgroundJobsEnabled: 'true',
      devPolicyBypass: 'false'
    }
  }
]

function usage() {
  return `
Usage:
  pnpm run validate:pm2-runtime
  pnpm run validate:pm2-runtime -- \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-prod-env console/.env.prod \\
    --console-test-env console/.env.test
  pnpm run validate:pm2-runtime -- --console-prod-cloudflare \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-test-env console/.env.test

Checks the tracked PM2 ecosystem templates by loading them with the selected env files.
It validates process names, ports, Nitro host/port, log file names, DB names, Platform URLs,
Console cache scope/fallback, Tenant Gateway trust, Collab mode, and that prod/dev/test
server processes do not collide. It does not start PM2.
Use --console-prod-cloudflare when production Console runs on Cloudflare Worker; this still checks
platform-prod, platform-dev and console-test PM2 templates, but skips the non-existent console-prod PM2 app.
Local console-dev is intentionally excluded because it is a developer Nuxt process, not a shared PM2 runtime.
`
}

function parseArgs(argv) {
  const result = {
    files: { ...DEFAULT_FILES },
    consoleProdCloudflare: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      result.help = true
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
    if (equalsIndex < 0) index += 1
  }

  return result
}

function formatPath(path) {
  return relative(process.cwd(), path) || '.'
}

function resolveExisting(path, label) {
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    throw new Error(`${label} not found: ${path}`)
  }
  return absolute
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/')
}

function assertEqual(errors, label, actual, expected, description) {
  if (String(actual ?? '') !== String(expected)) {
    errors.push(`${label} ${description}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
  }
}

function assertIncludes(errors, label, actual, expected, description) {
  if (!String(actual || '').includes(expected)) {
    errors.push(`${label} ${description}: ${JSON.stringify(actual)} does not include ${JSON.stringify(expected)}`)
  }
}

function loadEcosystem(scenario, envFile) {
  const moduleDir = resolve(process.cwd(), scenario.moduleDir)
  const configPath = resolve(moduleDir, 'ecosystem.config.cjs')
  resolveExisting(configPath, `${scenario.label} PM2 config`)

  const code = `
const config = require(${JSON.stringify(configPath)});
console.log(JSON.stringify(config));
`

  const childEnv = {
    ...process.env,
    [scenario.envVar]: envFile
  }
  for (const key of scenario.clearEnv) {
    childEnv[key] = ''
  }

  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: moduleDir,
    env: childEnv,
    encoding: 'utf8'
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(`${scenario.label} PM2 config failed to load${detail ? `: ${detail}` : ''}`)
  }

  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`${scenario.label} PM2 config did not emit valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function appEnv(app, key) {
  return String(app?.env?.[key] ?? '')
}

function validateApp(scenario, envFile) {
  const errors = []
  const config = loadEcosystem(scenario, envFile)
  const moduleDir = resolve(process.cwd(), scenario.moduleDir)
  const apps = Array.isArray(config.apps) ? config.apps : []
  if (apps.length !== 1) {
    errors.push(`${scenario.label} apps length: ${apps.length} !== 1`)
  }

  const app = apps[0] || {}
  const expected = scenario.expected
  assertEqual(errors, scenario.label, app.name, expected.name, 'PM2 name')
  assertEqual(errors, scenario.label, normalizePath(app.cwd), normalizePath(moduleDir), 'cwd')
  assertEqual(errors, scenario.label, app.script, '.output/server/index.mjs', 'script')
  assertEqual(errors, scenario.label, app.interpreter, 'node', 'interpreter')
  assertEqual(errors, scenario.label, app.exec_mode, 'fork', 'exec_mode')
  assertEqual(errors, scenario.label, app.instances, 1, 'instances')
  assertEqual(errors, scenario.label, app.watch, false, 'watch')
  assertEqual(errors, scenario.label, appEnv(app, 'NODE_ENV'), 'production', 'NODE_ENV')
  assertEqual(errors, scenario.label, appEnv(app, 'HOST'), expected.host, 'HOST')
  assertEqual(errors, scenario.label, appEnv(app, 'PORT'), expected.port, 'PORT')
  assertEqual(errors, scenario.label, appEnv(app, 'NITRO_HOST'), expected.host, 'NITRO_HOST')
  assertEqual(errors, scenario.label, appEnv(app, 'NITRO_PORT'), expected.port, 'NITRO_PORT')
  assertEqual(errors, scenario.label, appEnv(app, 'DB_NAME'), expected.dbName, 'DB_NAME')
  assertIncludes(errors, scenario.label, normalizePath(app.error_file), `logs/${expected.name}-error.log`, 'error_file')
  assertIncludes(errors, scenario.label, normalizePath(app.out_file), `logs/${expected.name}-out.log`, 'out_file')

  if (scenario.moduleDir === 'platform') {
    assertEqual(errors, scenario.label, appEnv(app, 'PLATFORM_SERVICE_URL'), expected.platformServiceUrl, 'PLATFORM_SERVICE_URL')
    assertEqual(errors, scenario.label, appEnv(app, 'NUXT_PUBLIC_PLATFORM_STAGE'), expected.platformStage, 'NUXT_PUBLIC_PLATFORM_STAGE')
  }

  if (scenario.moduleDir === 'console') {
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_CONSOLE_RUN_MODE'), expected.consoleRunMode, 'HZY_CONSOLE_RUN_MODE')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_URL'), expected.platformUrl, 'HZY_PLATFORM_URL')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_DEPLOYMENT_CODE'), expected.deploymentCode, 'HZY_PLATFORM_DEPLOYMENT_CODE')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND'), expected.cacheBackend, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_BUNDLE_CACHE_DIR'), expected.cacheDir, 'HZY_PLATFORM_BUNDLE_CACHE_DIR')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE'), expected.cacheScope, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK'), expected.cacheLegacyFallback, 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY'), expected.trustTenantGateway, 'HZY_CONSOLE_TRUST_TENANT_GATEWAY')
    assertEqual(errors, scenario.label, appEnv(app, 'CONSOLE_COLLAB_MODE'), expected.collabMode, 'CONSOLE_COLLAB_MODE')
    if (expected.collabPort) {
      assertEqual(errors, scenario.label, appEnv(app, 'COLLAB_PORT'), expected.collabPort, 'COLLAB_PORT')
    }
    if (appEnv(app, 'CONSOLE_COLLAB_MODE') === 'embedded') {
      if (!appEnv(app, 'COLLAB_DB_NAME')) {
        errors.push(`${scenario.label} COLLAB_DB_NAME: embedded Collab requires an explicit isolated DB name`)
      } else if (appEnv(app, 'COLLAB_DB_NAME') === 'hzy_console') {
        errors.push(`${scenario.label} COLLAB_DB_NAME: embedded Collab must not use hzy_console`)
      }
      if (expected.collabDbName) {
        assertEqual(errors, scenario.label, appEnv(app, 'COLLAB_DB_NAME'), expected.collabDbName, 'COLLAB_DB_NAME')
      }
    }
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_RUNTIME_ENABLED'), expected.runtimeEnabled, 'HZY_PLATFORM_RUNTIME_ENABLED')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_HEARTBEAT_ENABLED'), expected.heartbeatEnabled, 'HZY_PLATFORM_HEARTBEAT_ENABLED')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT'), expected.bundleRefreshOnBoot, 'HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE'), expected.authClientMaterialize, 'HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE'), expected.authClientMaterializeMode, 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE')
    assertEqual(errors, scenario.label, appEnv(app, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE'), expected.authSigningKeyAutogenerate, 'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE')
    assertEqual(errors, scenario.label, appEnv(app, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE'), expected.authSigningKeyRotateUnusable, 'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED'), expected.backgroundJobsEnabled, 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED')
    assertEqual(errors, scenario.label, appEnv(app, 'HZY_CONSOLE_DEV_POLICY_BYPASS'), expected.devPolicyBypass, 'HZY_CONSOLE_DEV_POLICY_BYPASS')
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  console.info(`[pm2-runtime] ${scenario.label} passed (${app.name} -> ${expected.host}:${expected.port}, env ${formatPath(envFile)})`)
  return {
    label: scenario.label,
    name: app.name,
    port: appEnv(app, 'PORT'),
    moduleDir: scenario.moduleDir
  }
}

function assertNoCollisions(results) {
  const byName = new Map()
  const byPort = new Map()
  const errors = []

  for (const result of results) {
    const nameOwner = byName.get(result.name)
    if (nameOwner) {
      errors.push(`PM2 name collision: ${result.name} used by ${nameOwner} and ${result.label}`)
    }
    byName.set(result.name, result.label)

    const portOwner = byPort.get(result.port)
    if (portOwner) {
      errors.push(`PM2 port collision: ${result.port} used by ${portOwner} and ${result.label}`)
    }
    byPort.set(result.port, result.label)
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const results = []
  const scenarios = args.consoleProdCloudflare
    ? SCENARIOS.filter(scenario => scenario.key !== 'consoleProd')
    : SCENARIOS

  for (const scenario of scenarios) {
    const envFile = resolveExisting(args.files[scenario.key], `${scenario.label} env file`)
    results.push(validateApp(scenario, envFile))
  }
  assertNoCollisions(results)
  console.info('[pm2-runtime] passed')
}

try {
  main()
} catch (error) {
  console.error(`[pm2-runtime] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
