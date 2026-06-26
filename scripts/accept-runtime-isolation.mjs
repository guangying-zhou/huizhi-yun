#!/usr/bin/env node
import { spawn } from 'node:child_process'
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

const FILE_OPTIONS = {
  'platform-prod-env': 'platformProd',
  'platform-dev-env': 'platformDev',
  'console-prod-env': 'consoleProd',
  'console-test-env': 'consoleTest',
  'console-dev-env': 'consoleDev'
}

const CONSOLE_DB_VALUE_OPTIONS = new Set([
  'host',
  'port',
  'user',
  'password',
  'password-env',
  'table',
  'cache-rows-file'
])

const PLATFORM_DEV_DB_VALUE_OPTIONS = new Set([
  'host',
  'port',
  'user',
  'password',
  'password-env',
  'mode',
  'expected-test-public-url',
  'expected-test-deployment-code',
  'expected-test-environment',
  'expected-test-app-code'
])

function usage() {
  return `
Usage:
  pnpm run accept:runtime-isolation

  pnpm run accept:runtime-isolation -- --static-only \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-prod-env console/.env.prod \\
    --console-test-env console/.env.test \\
    --console-dev-env console/.env.dev

  pnpm run accept:runtime-isolation -- --strict \\
    --platform-prod-env platform/.env.prod \\
    --platform-dev-env platform/.env.dev \\
    --console-prod-env console/.env.prod \\
    --console-test-env console/.env.test \\
    --console-dev-env console/.env.dev \\
    --platform-prod-url http://127.0.0.1:3010 \\
    --platform-dev-url http://127.0.0.1:3011 \\
    --console-prod-url http://127.0.0.1:3030 \\
    --console-test-url http://127.0.0.1:3031 \\
    --platform-prod-token-env PLATFORM_PROD_DIAGNOSTICS_TOKEN \\
    --platform-dev-token-env PLATFORM_DEV_DIAGNOSTICS_TOKEN \\
    --console-prod-token-env CONSOLE_PROD_DIAGNOSTICS_TOKEN \\
    --console-test-token-env CONSOLE_TEST_DIAGNOSTICS_TOKEN \\
    --console-db-host 127.0.0.1 \\
    --console-db-user root \\
    --console-db-password-env CONSOLE_DB_PASSWORD \\
    --console-db hzy_console \\
    --platform-dev-db-host 127.0.0.1 \\
    --platform-dev-db-user root \\
    --platform-dev-db-password-env PLATFORM_DEV_DB_PASSWORD \\
    --platform-dev-db hzy_platform_dev \\
    --platform-dev-db-mode ready \\
    --platform-dev-db-expected-test-public-url https://hzy-test.wiztek.cn \\
    --expected-test-deployment-code wiztek-test-console \\
    --pm2-live \\
    --public-routing \\
    --public-routing-expected-server-ip 8.130.81.31 \\
    --public-routing-platform-prod-url https://platform.wiztek.cn \\
    --public-routing-platform-dev-url https://platform-dev.wiztek.cn \\
    --public-routing-console-prod-url https://hzy.wiztek.cn \\
    --public-routing-console-test-url https://hzy-test.wiztek.cn \\
    --nginx-platform-conf /etc/nginx/conf.d/platform-wiztek.conf \\
    --nginx-console-conf /etc/nginx/conf.d/console-wiztek.conf

  # If console-prod runs on Cloudflare, keep the console-prod URL probe but skip
  # the non-existent console-prod PM2 template and live process checks:
  pnpm run accept:runtime-isolation -- --strict --console-prod-cloudflare \\
    --console-prod-env console/.env.cloudflare \\
    --pm2-live --public-routing --public-routing-expected-server-ip 8.130.81.31 \\
    --nginx-platform-conf /etc/nginx/conf.d/platform-wiztek.conf \\
    --nginx-console-test-only-conf /etc/nginx/conf.d/console-wiztek.conf ...

  # Offline PM2 verifier regression only; not allowed with --strict:
  pnpm run accept:runtime-isolation -- --pm2-live \\
    --pm2-jlist-file scripts/fixtures/pm2-jlist-runtime-isolation.json

With no URLs or DB options, this runs the static env isolation, PM2 runtime, Console Cloudflare config, and Nginx routing checks against tracked templates.
Use --static-only when you intentionally want a static-only gate against real env files.
Do not combine --strict and --static-only: --strict is the final live acceptance gate,
while --static-only is an env/template precheck.
When --console-prod-cloudflare is used without --console-prod-env, the tracked
console/.env.cloudflare.example is used for console-prod static checks.
With --strict and without --static-only, live PM2 verification, public routing,
live Platform/Console probe URLs plus Console DB and platform-dev DB verification
options are required. Strict also requires copied server Nginx config paths:
--nginx-platform-conf plus either --nginx-console-conf or --nginx-console-test-only-conf.
When --pm2-live is provided, acceptance also verifies the loopback upstream URLs
that Nginx should proxy to before running the public routing probe.
Strict public routing also requires a fixed IP expectation for Platform domains:
pass --public-routing-expected-server-ip, --public-routing-expected-platform-ip,
--public-routing-expected-ip, or their -env variants.
Strict final acceptance requires explicit real env files and rejects tracked
*.example env files.
Strict final acceptance rejects fixture PM2 input, shared PM2 workdirs, skipped
HTTP public routing checks, Platform-on-Cloudflare overrides, and legacy
unscoped Console runtime cache fallback.
When --platform-dev-db is provided, DB mode defaults to ready because this script is the final deployment gate.
The script only prints command structure and non-secret probe output; pass secrets by env var names.
When prod or test uses DB runtime cache, add --console-db-require-prod-cache and/or --console-db-require-test-cache.
`
}

function parseArgs(argv) {
  const args = {
    files: { ...DEFAULT_FILES },
    providedFiles: new Set(),
    strict: false,
    platformUrls: {},
    consoleUrls: {},
    platformToken: '',
    consoleToken: '',
    consoleDb: {},
    platformDevDb: {},
    staticOnly: false,
    pm2Live: false,
    pm2JlistFile: '',
    consoleProdCloudflare: false,
    allowSharedPm2Cwd: false,
    publicRouting: false,
    publicRoutingExpectedIp: '',
    publicRoutingExpectedIpEnv: '',
    publicRoutingExpectedServerIp: '',
    publicRoutingExpectedServerIpEnv: '',
    publicRoutingExpectedPlatformIp: '',
    publicRoutingExpectedPlatformIpEnv: '',
    publicRoutingConsoleProdExpectedIp: '',
    publicRoutingConsoleProdExpectedIpEnv: '',
    publicRoutingConsoleTestExpectedIp: '',
    publicRoutingConsoleTestExpectedIpEnv: '',
    publicRoutingUrls: {},
    publicRoutingTimeoutMs: '',
    nginx: {}
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
    if (item === '--strict') {
      args.strict = true
      continue
    }
    if (item === '--static-only') {
      args.staticOnly = true
      continue
    }
    if (item === '--pm2-live') {
      args.pm2Live = true
      continue
    }
    if (item === '--console-prod-cloudflare') {
      args.consoleProdCloudflare = true
      continue
    }
    if (item === '--allow-shared-pm2-cwd') {
      args.allowSharedPm2Cwd = true
      continue
    }
    if (item === '--public-routing') {
      args.publicRouting = true
      continue
    }
    if (item === '--public-routing-skip-http') {
      args.publicRoutingSkipHttp = true
      continue
    }
    if (item === '--allow-platform-cloudflare') {
      args.allowPlatformCloudflare = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (FILE_OPTIONS[name]) {
      const fileKey = FILE_OPTIONS[name]
      args.files[fileKey] = requiredValue(name, value)
      args.providedFiles.add(fileKey)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'pm2-jlist-file') {
      args.pm2JlistFile = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'platform-prod-url') {
      args.platformUrls.prod = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'platform-dev-url') {
      args.platformUrls.dev = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-prod-url') {
      args.consoleUrls.prod = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-test-url') {
      args.consoleUrls.test = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-dev-url') {
      args.consoleUrls.dev = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'platform-token') {
      args.platformToken = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'platform-token-env') {
      args.platformTokenEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['platform-prod-token', 'platform-dev-token'].includes(name)) {
      const target = name.slice('platform-'.length, -'-token'.length)
      args.platformTokens = args.platformTokens || {}
      args.platformTokens[target] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['platform-prod-token-env', 'platform-dev-token-env'].includes(name)) {
      const target = name.slice('platform-'.length, -'-token-env'.length)
      args.platformTokenEnvs = args.platformTokenEnvs || {}
      args.platformTokenEnvs[target] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-token') {
      args.consoleToken = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-token-env') {
      args.consoleTokenEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['console-prod-token', 'console-test-token', 'console-dev-token'].includes(name)) {
      const target = name.slice('console-'.length, -'-token'.length)
      args.consoleTokens = args.consoleTokens || {}
      args.consoleTokens[target] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['console-prod-token-env', 'console-test-token-env', 'console-dev-token-env'].includes(name)) {
      const target = name.slice('console-'.length, -'-token-env'.length)
      args.consoleTokenEnvs = args.consoleTokenEnvs || {}
      args.consoleTokenEnvs[target] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-db-require-prod-cache') {
      args.consoleDb.requireProdCache = true
      continue
    }

    if (name === 'console-db-require-test-cache') {
      args.consoleDb.requireTestCache = true
      continue
    }

    if (name === 'console-db-allow-legacy-unscoped') {
      args.consoleDb.allowLegacyUnscoped = true
      continue
    }

    if (name === 'console-db') {
      args.consoleDb.db = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name.startsWith('console-db-')) {
      const rawKey = name.slice('console-db-'.length)
      if (!CONSOLE_DB_VALUE_OPTIONS.has(rawKey)) {
        throw new Error(`unknown option: --${name}`)
      }
      const key = name.slice('console-db-'.length).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      args.consoleDb[key] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'platform-dev-db-require-heartbeat') {
      args.platformDevDb.requireHeartbeat = true
      continue
    }

    if (name === 'platform-dev-db') {
      args.platformDevDb.db = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name.startsWith('platform-dev-db-')) {
      const rawKey = name.slice('platform-dev-db-'.length)
      if (!PLATFORM_DEV_DB_VALUE_OPTIONS.has(rawKey)) {
        throw new Error(`unknown option: --${name}`)
      }
      const key = name.slice('platform-dev-db-'.length).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      args.platformDevDb[key] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-test-deployment-code') {
      args.platformDevDb.expectedTestDeploymentCode = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-test-environment') {
      args.platformDevDb.expectedTestEnvironment = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-expected-ip') {
      args.publicRoutingExpectedIp = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-expected-ip-env') {
      args.publicRoutingExpectedIpEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-expected-server-ip') {
      args.publicRoutingExpectedServerIp = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-expected-server-ip-env') {
      args.publicRoutingExpectedServerIpEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-expected-platform-ip') {
      args.publicRoutingExpectedPlatformIp = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-expected-platform-ip-env') {
      args.publicRoutingExpectedPlatformIpEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-console-prod-expected-ip') {
      args.publicRoutingConsoleProdExpectedIp = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-console-prod-expected-ip-env') {
      args.publicRoutingConsoleProdExpectedIpEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-console-test-expected-ip') {
      args.publicRoutingConsoleTestExpectedIp = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-console-test-expected-ip-env') {
      args.publicRoutingConsoleTestExpectedIpEnv = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-platform-prod-url') {
      args.publicRoutingUrls.platformProd = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-platform-dev-url') {
      args.publicRoutingUrls.platformDev = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-console-prod-url') {
      args.publicRoutingUrls.consoleProd = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-console-test-url') {
      args.publicRoutingUrls.consoleTest = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'public-routing-timeout-ms') {
      args.publicRoutingTimeoutMs = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'nginx-platform-conf') {
      args.nginx.platformConf = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'nginx-console-conf') {
      args.nginx.consoleConf = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'nginx-console-test-only-conf') {
      args.nginx.consoleTestOnlyConf = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  if (args.consoleProdCloudflare && !args.providedFiles.has('consoleProd')) {
    args.files.consoleProd = 'console/.env.cloudflare.example'
  }

  return args
}

function requiredValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for --${name}`)
  }
  return value
}

function existingPath(path) {
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    throw new Error(`file not found: ${path}`)
  }
  return path
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

function parseEnvFile(path, label) {
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    throw new Error(`${label} env file not found: ${path}`)
  }

  const env = {}
  const raw = readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '')
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

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = String(env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function envBool(env, ...keys) {
  const normalized = envValue(env, ...keys).toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function consoleUsesDbRuntimeCache(env) {
  const backend = envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND').toLowerCase()
  return backend === 'db'
    || envBool(env, 'HZY_CLOUDFLARE_RUNTIME')
    || envBool(env, 'HZY_CLOUDFLARE_BUILD')
}

function fileArgs(files, names) {
  return names.flatMap(([scriptName, key]) => [`--${scriptName}`, existingPath(files[key])])
}

function hasAnyValue(record) {
  return Object.values(record).some(Boolean)
}

function isExampleEnvFile(path) {
  return String(path || '').trim().endsWith('.example')
}

function assertModeCompatibility(args) {
  if (args.strict && args.staticOnly) {
    throw new Error('--strict and --static-only cannot be combined; use --strict for final live acceptance, or --static-only for env/template precheck')
  }
}

function assertStrictCoverage(args) {
  if (!args.strict || args.staticOnly) {
    return
  }

  const missing = []
  const consoleProdEnv = parseEnvFile(args.files.consoleProd, 'console-prod')
  const consoleTestEnv = parseEnvFile(args.files.consoleTest, 'console-test')
  const requiredEnvFiles = [
    ['platformProd', '--platform-prod-env platform/.env.prod'],
    ['platformDev', '--platform-dev-env platform/.env.dev'],
    ['consoleTest', '--console-test-env console/.env.test'],
    ['consoleDev', '--console-dev-env console/.env.dev']
  ]
  if (args.consoleProdCloudflare) {
    requiredEnvFiles.push(['consoleProd', '--console-prod-env console/.env.cloudflare'])
  } else {
    requiredEnvFiles.push(['consoleProd', '--console-prod-env console/.env.prod'])
  }

  for (const [fileKey, option] of requiredEnvFiles) {
    if (!args.providedFiles.has(fileKey)) {
      missing.push(option)
    } else if (isExampleEnvFile(args.files[fileKey])) {
      missing.push(`replace ${option.split(' ')[0]} ${args.files[fileKey]} with a real env file; --strict must not use tracked *.example env files`)
    }
  }
  if (!args.platformUrls.prod) missing.push('--platform-prod-url')
  if (!args.platformUrls.dev) missing.push('--platform-dev-url')
  if (!args.consoleUrls.prod) missing.push('--console-prod-url')
  if (!args.consoleUrls.test) missing.push('--console-test-url')
  if (!args.consoleDb.db) missing.push('--console-db')
  if (!args.platformDevDb.db) missing.push('--platform-dev-db')
  if (!args.platformDevDb.expectedTestDeploymentCode) missing.push('--expected-test-deployment-code')
  if (!args.platformDevDb.expectedTestPublicUrl) missing.push('--platform-dev-db-expected-test-public-url')
  if (!args.pm2Live) missing.push('--pm2-live')
  if (!args.nginx.platformConf) missing.push('--nginx-platform-conf')
  if (args.consoleProdCloudflare) {
    if (!args.nginx.consoleTestOnlyConf) missing.push('--nginx-console-test-only-conf')
    if (args.nginx.consoleConf) missing.push('remove --nginx-console-conf when --console-prod-cloudflare is used; use --nginx-console-test-only-conf')
  } else if (!args.nginx.consoleConf) {
    missing.push('--nginx-console-conf')
  }
  if (args.pm2JlistFile) missing.push('remove --pm2-jlist-file; --strict must read live pm2 jlist')
  if (args.allowSharedPm2Cwd) missing.push('remove --allow-shared-pm2-cwd; --strict requires separate release workdirs')
  if (!args.publicRouting) missing.push('--public-routing')
  if (args.publicRoutingSkipHttp) missing.push('remove --public-routing-skip-http; --strict must verify HTTP reachability')
  if (args.allowPlatformCloudflare) missing.push('remove --allow-platform-cloudflare; wiztek Platform strict acceptance must not use Cloudflare')
  if (args.consoleDb.allowLegacyUnscoped) missing.push('remove --console-db-allow-legacy-unscoped; --strict requires scoped Console runtime cache keys')
  if (args.consoleDb.cacheRowsFile) missing.push('remove --console-db-cache-rows-file; --strict must read live Console DB')
  if (consoleUsesDbRuntimeCache(consoleProdEnv) && !args.consoleDb.requireProdCache) {
    missing.push('--console-db-require-prod-cache because console-prod uses DB runtime cache')
  }
  if (consoleUsesDbRuntimeCache(consoleTestEnv) && !args.consoleDb.requireTestCache) {
    missing.push('--console-db-require-test-cache because console-test uses DB runtime cache')
  }
  if (
    args.publicRouting
    && !args.publicRoutingExpectedIp
    && !args.publicRoutingExpectedIpEnv
    && !args.publicRoutingExpectedServerIp
    && !args.publicRoutingExpectedServerIpEnv
    && !args.publicRoutingExpectedPlatformIp
    && !args.publicRoutingExpectedPlatformIpEnv
  ) {
    missing.push('--public-routing-expected-server-ip, --public-routing-expected-platform-ip, or an -env variant')
  }

  const platformDevDbMode = String(args.platformDevDb.mode || 'ready').trim()
  if (platformDevDbMode !== 'ready') {
    missing.push('--platform-dev-db-mode ready')
  }

  if (missing.length) {
    throw new Error(
      `--strict final acceptance requires ${missing.join(', ')}. ` +
      'Use --static-only for a static-only env/template gate.'
    )
  }
}

function assertStaticOnlyCoverage(args) {
  if (!args.staticOnly) {
    return
  }

  const runtimeOptions = []
  if (hasAnyValue(args.platformUrls)) runtimeOptions.push('--platform-*-url')
  if (hasAnyValue(args.consoleUrls)) runtimeOptions.push('--console-*-url')
  if (hasAnyValue(args.consoleDb)) runtimeOptions.push('--console-db-*')
  if (hasAnyValue(args.platformDevDb)) runtimeOptions.push('--platform-dev-db-*')
  if (args.pm2Live) runtimeOptions.push('--pm2-live')
  if (args.pm2JlistFile) runtimeOptions.push('--pm2-jlist-file')
  if (args.publicRouting) runtimeOptions.push('--public-routing')
  if (args.publicRoutingExpectedIp) runtimeOptions.push('--public-routing-expected-ip')
  if (args.publicRoutingExpectedIpEnv) runtimeOptions.push('--public-routing-expected-ip-env')
  if (args.publicRoutingExpectedServerIp) runtimeOptions.push('--public-routing-expected-server-ip')
  if (args.publicRoutingExpectedServerIpEnv) runtimeOptions.push('--public-routing-expected-server-ip-env')
  if (args.publicRoutingExpectedPlatformIp) runtimeOptions.push('--public-routing-expected-platform-ip')
  if (args.publicRoutingExpectedPlatformIpEnv) runtimeOptions.push('--public-routing-expected-platform-ip-env')
  if (args.publicRoutingConsoleProdExpectedIp) runtimeOptions.push('--public-routing-console-prod-expected-ip')
  if (args.publicRoutingConsoleProdExpectedIpEnv) runtimeOptions.push('--public-routing-console-prod-expected-ip-env')
  if (args.publicRoutingConsoleTestExpectedIp) runtimeOptions.push('--public-routing-console-test-expected-ip')
  if (args.publicRoutingConsoleTestExpectedIpEnv) runtimeOptions.push('--public-routing-console-test-expected-ip-env')
  if (hasAnyValue(args.publicRoutingUrls)) runtimeOptions.push('--public-routing-*-url')
  if (args.publicRoutingTimeoutMs) runtimeOptions.push('--public-routing-timeout-ms')
  if (args.publicRoutingSkipHttp) runtimeOptions.push('--public-routing-skip-http')
  if (args.allowPlatformCloudflare) runtimeOptions.push('--allow-platform-cloudflare')
  if (args.allowSharedPm2Cwd) runtimeOptions.push('--allow-shared-pm2-cwd')

  if (runtimeOptions.length) {
    throw new Error(
      `--static-only cannot be combined with runtime verification options: ${runtimeOptions.join(', ')}`
    )
  }
}

function pushNginxArgs(commandArgs, nginx) {
  if (nginx.platformConf) commandArgs.push('--platform-conf', nginx.platformConf)
  if (nginx.consoleConf) commandArgs.push('--console-conf', nginx.consoleConf)
  if (nginx.consoleTestOnlyConf) commandArgs.push('--console-test-only-conf', nginx.consoleTestOnlyConf)
}

function pushTokenArgs(commandArgs, actualArgs, optionName, token) {
  commandArgs.push(optionName, '<redacted>')
  actualArgs.push(optionName, token)
}

function runCommand(label, command, args, displayArgs = args) {
  console.info(`[runtime-acceptance] ${label}`)
  console.info(`[runtime-acceptance] $ ${[command, ...displayArgs].join(' ')}`)

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`))
    })
  })
}

async function runStaticValidation(args) {
  await runCommand('tracked env file safety validation', 'node', [
    'scripts/validate-env-tracking.mjs'
  ])
  await runCommand('Platform environment-scoped runtime token validation', 'node', [
    'scripts/validate-platform-environment-isolation.mjs'
  ])
  await runCommand('Platform signing readiness validation', 'node', [
    'scripts/validate-platform-signing-readiness.mjs'
  ])
  await runCommand('Console runtime-disabled short-circuit validation', 'node', [
    'scripts/validate-console-runtime-disabled.mjs'
  ])
  await runCommand('Console runtime cache verifier guardrail validation', 'node', [
    'scripts/validate-console-runtime-cache-guardrails.mjs'
  ])
  await runCommand('runtime isolation documentation consistency validation', 'node', [
    'scripts/validate-runtime-isolation-docs.mjs'
  ])
  await runCommand('strict acceptance guardrail validation', 'node', [
    'scripts/validate-runtime-acceptance-strict.mjs'
  ])
  await runCommand('runtime probe guardrail validation', 'node', [
    'scripts/validate-runtime-probe-guardrails.mjs'
  ])
  await runCommand('public routing plan validation', 'node', [
    'scripts/validate-public-routing-plan.mjs'
  ])
  const commandArgs = [
    'scripts/validate-runtime-isolation.mjs',
    ...(args.strict ? ['--strict'] : []),
    ...(args.consoleProdCloudflare ? ['--console-prod-cloudflare'] : []),
    ...fileArgs(args.files, [
      ['platform-prod-env', 'platformProd'],
      ['platform-dev-env', 'platformDev'],
      ['console-prod-env', 'consoleProd'],
      ['console-test-env', 'consoleTest'],
      ['console-dev-env', 'consoleDev']
    ])
  ]
  await runCommand('static env isolation validation', 'node', commandArgs)
  await runCommand('strict Platform/Console signing key fixture validation', 'node', [
    'scripts/validate-runtime-isolation-key-fixture.mjs'
  ])
}

async function runPm2RuntimeValidation(args) {
  const envFiles = [
    ['platform-prod-env', 'platformProd'],
    ['platform-dev-env', 'platformDev']
  ]
  if (!args.consoleProdCloudflare) {
    envFiles.push(['console-prod-env', 'consoleProd'])
  }
  envFiles.push(['console-test-env', 'consoleTest'])

  const commandArgs = [
    'scripts/validate-pm2-runtime.mjs',
    ...fileArgs(args.files, envFiles)
  ]
  if (args.consoleProdCloudflare) commandArgs.push('--console-prod-cloudflare')
  await runCommand('static PM2 runtime validation', 'node', commandArgs)
}

async function runConsoleCloudflareValidation(args) {
  const commandArgs = ['scripts/validate-console-cloudflare-config.mjs']
  if (args.consoleProdCloudflare) {
    commandArgs.push('--env-file', existingPath(args.files.consoleProd))
    if (args.strict && !args.staticOnly) commandArgs.push('--strict-env')
  }
  await runCommand('static Console Cloudflare validation', 'node', commandArgs)
}

async function runBusinessCloudflareValidation() {
  await runCommand('static business app Cloudflare validation', 'node', ['scripts/validate-business-cloudflare-config.mjs'])
}

async function runPlatformCloudflareGuardValidation() {
  await runCommand('static Platform Cloudflare deploy guard validation', 'node', ['scripts/validate-platform-cloudflare-guard.mjs'])
}

async function runPm2LiveVerify(args) {
  if (!args.pm2Live) {
    console.info('[runtime-acceptance] live PM2 verification skipped: no --pm2-live provided')
    return
  }

  const envFiles = [
    ['platform-prod-env', 'platformProd'],
    ['platform-dev-env', 'platformDev']
  ]
  if (!args.consoleProdCloudflare) {
    envFiles.push(['console-prod-env', 'consoleProd'])
  }
  envFiles.push(['console-test-env', 'consoleTest'])

  const commandArgs = [
    'scripts/verify-pm2-live.mjs',
    ...fileArgs(args.files, envFiles)
  ]
  if (args.consoleProdCloudflare) commandArgs.push('--console-prod-cloudflare')
  if (args.allowSharedPm2Cwd) commandArgs.push('--allow-shared-cwd')
  if (args.pm2JlistFile) commandArgs.push('--pm2-jlist-file', args.pm2JlistFile)
  await runCommand('live PM2 verification', 'node', commandArgs)
}

async function runServerUpstreamsProbe(args) {
  if (!args.pm2Live) {
    console.info('[runtime-acceptance] server upstream probe skipped: no --pm2-live provided')
    return
  }

  const commandArgs = ['scripts/probe-server-upstreams.mjs']
  if (args.consoleProdCloudflare) commandArgs.push('--console-prod-cloudflare')
  if (args.pm2JlistFile) {
    commandArgs.push('--pm2-jlist-file', args.pm2JlistFile, '--skip-http')
  }
  await runCommand('server upstream loopback probe', 'node', commandArgs)
}

async function runNginxRoutingValidation(args) {
  const commandArgs = ['scripts/validate-nginx-routing.mjs']
  pushNginxArgs(commandArgs, args.nginx)
  await runCommand('static Nginx routing validation', 'node', commandArgs)
}

async function runPublicRoutingProbe(args) {
  if (!args.publicRouting) {
    console.info('[runtime-acceptance] public routing probe skipped: no --public-routing provided')
    return
  }

  const commandArgs = ['scripts/probe-public-routing.mjs']
  if (args.consoleProdCloudflare) commandArgs.push('--console-prod-cloudflare')
  if (args.publicRoutingExpectedIp) commandArgs.push('--expected-ip', args.publicRoutingExpectedIp)
  if (args.publicRoutingExpectedIpEnv) commandArgs.push('--expected-ip-env', args.publicRoutingExpectedIpEnv)
  if (args.publicRoutingExpectedServerIp) commandArgs.push('--expected-server-ip', args.publicRoutingExpectedServerIp)
  if (args.publicRoutingExpectedServerIpEnv) commandArgs.push('--expected-server-ip-env', args.publicRoutingExpectedServerIpEnv)
  if (args.publicRoutingExpectedPlatformIp) commandArgs.push('--expected-platform-ip', args.publicRoutingExpectedPlatformIp)
  if (args.publicRoutingExpectedPlatformIpEnv) commandArgs.push('--expected-platform-ip-env', args.publicRoutingExpectedPlatformIpEnv)
  if (args.publicRoutingConsoleProdExpectedIp) commandArgs.push('--console-prod-expected-ip', args.publicRoutingConsoleProdExpectedIp)
  if (args.publicRoutingConsoleProdExpectedIpEnv) commandArgs.push('--console-prod-expected-ip-env', args.publicRoutingConsoleProdExpectedIpEnv)
  if (args.publicRoutingConsoleTestExpectedIp) commandArgs.push('--console-test-expected-ip', args.publicRoutingConsoleTestExpectedIp)
  if (args.publicRoutingConsoleTestExpectedIpEnv) commandArgs.push('--console-test-expected-ip-env', args.publicRoutingConsoleTestExpectedIpEnv)
  if (args.publicRoutingUrls.platformProd) commandArgs.push('--platform-prod-url', args.publicRoutingUrls.platformProd)
  if (args.publicRoutingUrls.platformDev) commandArgs.push('--platform-dev-url', args.publicRoutingUrls.platformDev)
  if (args.publicRoutingUrls.consoleProd) commandArgs.push('--console-prod-url', args.publicRoutingUrls.consoleProd)
  if (args.publicRoutingUrls.consoleTest) commandArgs.push('--console-test-url', args.publicRoutingUrls.consoleTest)
  if (args.publicRoutingTimeoutMs) commandArgs.push('--timeout-ms', args.publicRoutingTimeoutMs)
  if (args.publicRoutingSkipHttp) commandArgs.push('--skip-http')
  if (args.allowPlatformCloudflare) commandArgs.push('--allow-platform-cloudflare')
  await runCommand('public routing probe', 'node', commandArgs)
}

async function runPlatformProbe(args) {
  if (!hasAnyValue(args.platformUrls)) {
    console.info('[runtime-acceptance] platform runtime probe skipped: no --platform-*-url provided')
    return
  }

  const commandArgs = [
    'scripts/probe-platform-runtime.mjs',
    ...fileArgs(args.files, [
      ['platform-prod-env', 'platformProd'],
      ['platform-dev-env', 'platformDev']
    ])
  ]
  if (args.platformUrls.prod) commandArgs.push('--prod-url', args.platformUrls.prod)
  if (args.platformUrls.dev) commandArgs.push('--dev-url', args.platformUrls.dev)
  const actualArgs = [...commandArgs]
  if (args.platformToken) pushTokenArgs(commandArgs, actualArgs, '--token', args.platformToken)
  if (args.platformTokenEnv) commandArgs.push('--token-env', args.platformTokenEnv)
  if (args.platformTokenEnv) actualArgs.push('--token-env', args.platformTokenEnv)
  for (const target of ['prod', 'dev']) {
    const token = args.platformTokens?.[target]
    const tokenEnv = args.platformTokenEnvs?.[target]
    if (token) pushTokenArgs(commandArgs, actualArgs, `--${target}-token`, token)
    if (tokenEnv) {
      commandArgs.push(`--${target}-token-env`, tokenEnv)
      actualArgs.push(`--${target}-token-env`, tokenEnv)
    }
  }
  await runCommand('Platform runtime probe', 'node', actualArgs, commandArgs)
}

async function runConsoleProbe(args) {
  if (!hasAnyValue(args.consoleUrls)) {
    console.info('[runtime-acceptance] console runtime probe skipped: no --console-*-url provided')
    return
  }

  const commandArgs = [
    'scripts/probe-console-runtime.mjs',
    ...fileArgs(args.files, [
      ['platform-prod-env', 'platformProd'],
      ['platform-dev-env', 'platformDev'],
      ['console-prod-env', 'consoleProd'],
      ['console-test-env', 'consoleTest'],
      ['console-dev-env', 'consoleDev']
    ])
  ]
  if (args.consoleUrls.prod) commandArgs.push('--prod-url', args.consoleUrls.prod)
  if (args.consoleUrls.test) commandArgs.push('--test-url', args.consoleUrls.test)
  if (args.consoleUrls.dev) commandArgs.push('--dev-url', args.consoleUrls.dev)
  const actualArgs = [...commandArgs]
  if (args.consoleToken) pushTokenArgs(commandArgs, actualArgs, '--token', args.consoleToken)
  if (args.consoleTokenEnv) commandArgs.push('--token-env', args.consoleTokenEnv)
  if (args.consoleTokenEnv) actualArgs.push('--token-env', args.consoleTokenEnv)
  for (const target of ['prod', 'test', 'dev']) {
    const token = args.consoleTokens?.[target]
    const tokenEnv = args.consoleTokenEnvs?.[target]
    if (token) pushTokenArgs(commandArgs, actualArgs, `--${target}-token`, token)
    if (tokenEnv) {
      commandArgs.push(`--${target}-token-env`, tokenEnv)
      actualArgs.push(`--${target}-token-env`, tokenEnv)
    }
  }
  await runCommand('Console runtime probe', 'node', actualArgs, commandArgs)
}

async function runConsoleRuntimeCacheVerify(args) {
  const db = args.consoleDb
  if (!hasAnyValue(db)) {
    console.info('[runtime-acceptance] console runtime cache verification skipped: no --console-db provided')
    return
  }

  if (!db.db) {
    throw new Error('--console-db is required when Console runtime cache verification options are used')
  }

  const commandArgs = [
    'scripts/verify-console-runtime-cache.mjs',
    ...fileArgs(args.files, [
      ['console-prod-env', 'consoleProd'],
      ['console-test-env', 'consoleTest']
    ]),
    '--db',
    db.db
  ]
  const displayArgs = [...commandArgs]

  for (const key of ['host', 'port', 'user', 'passwordEnv', 'table', 'cacheRowsFile']) {
    if (!db[key]) continue
    const optionName = `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
    commandArgs.push(optionName, db[key])
    displayArgs.push(optionName, db[key])
  }
  if (db.password) {
    commandArgs.push('--password', db.password)
    displayArgs.push('--password', '<redacted>')
  }
  if (db.requireProdCache) {
    commandArgs.push('--require-prod-cache')
    displayArgs.push('--require-prod-cache')
  }
  if (db.requireTestCache) {
    commandArgs.push('--require-test-cache')
    displayArgs.push('--require-test-cache')
  }
  if (db.allowLegacyUnscoped) {
    commandArgs.push('--allow-legacy-unscoped')
    displayArgs.push('--allow-legacy-unscoped')
  }

  await runCommand('Console runtime cache verification', 'node', commandArgs, displayArgs)
}

async function runPlatformDevDbVerify(args) {
  const db = args.platformDevDb
  if (!hasAnyValue(db)) {
    console.info('[runtime-acceptance] platform dev DB verification skipped: no --platform-dev-db provided')
    return
  }

  if (!db.db) {
    throw new Error('--platform-dev-db is required when platform dev DB verification options are used')
  }

  const commandArgs = ['platform/scripts/verify-platform-dev-db.mjs', '--db', db.db, '--mode', db.mode || 'ready']
  const displayArgs = [...commandArgs]
  for (const key of ['host', 'port', 'user', 'passwordEnv', 'expectedTestPublicUrl', 'expectedTestDeploymentCode', 'expectedTestEnvironment', 'expectedTestAppCode']) {
    if (!db[key]) continue
    const optionName = `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
    commandArgs.push(optionName, db[key])
    displayArgs.push(optionName, db[key])
  }
  if (db.password) {
    commandArgs.push('--password', db.password)
    displayArgs.push('--password', '<redacted>')
  }
  if (db.requireHeartbeat) {
    commandArgs.push('--require-heartbeat')
    displayArgs.push('--require-heartbeat')
  }

  await runCommand('Platform dev DB verification', 'node', commandArgs, displayArgs)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  assertModeCompatibility(args)
  assertStrictCoverage(args)
  assertStaticOnlyCoverage(args)
  await runStaticValidation(args)
  await runPm2RuntimeValidation(args)
  await runConsoleCloudflareValidation(args)
  await runBusinessCloudflareValidation()
  await runPlatformCloudflareGuardValidation()
  await runNginxRoutingValidation(args)
  await runPm2LiveVerify(args)
  await runServerUpstreamsProbe(args)
  await runPublicRoutingProbe(args)
  if (args.staticOnly) {
    console.info('[runtime-acceptance] static-only checks passed')
    return
  }
  await runPlatformProbe(args)
  await runConsoleProbe(args)
  await runConsoleRuntimeCacheVerify(args)
  await runPlatformDevDbVerify(args)
  console.info('[runtime-acceptance] passed')
}

main().catch((error) => {
  console.error(`[runtime-acceptance] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
