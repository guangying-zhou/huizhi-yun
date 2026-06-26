import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MANAGED_CLOUD_PROFILES = new Set([
  'managed-cloud-agent',
  'managed-cloud-direct-db',
  'managed-cloud-d1'
])
const DEFAULT_MANAGED_CONSOLE_URL = 'https://console.huizhi.yun'

export function value(name, fallback = '') {
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

function resolveOptionalEnvPath(path, rootDir, repoRoot) {
  if (!path) return ''
  if (path.startsWith('/')) return path
  if (path.startsWith('./') || path.startsWith('../')) {
    return resolve(rootDir, path)
  }
  return resolve(repoRoot, path)
}

function loadEnvFiles(files, rootDir, repoRoot) {
  const protectedKeys = new Set(
    Object.entries(process.env)
      .filter(([, item]) => String(item || '') !== '')
      .map(([key]) => key)
  )
  const loaded = []

  for (const fileEntry of files) {
    const file = typeof fileEntry === 'string' ? fileEntry : fileEntry.path
    const skipKeys = new Set(typeof fileEntry === 'string' ? [] : fileEntry.skipKeys || [])
    const envPath = resolveOptionalEnvPath(file, rootDir, repoRoot)
    if (!envPath || !existsSync(envPath)) continue

    const parsed = parseEnvFile(readFileSync(envPath, 'utf8'))
    for (const [key, item] of Object.entries(parsed)) {
      if (skipKeys.has(key)) continue
      if (protectedKeys.has(key)) continue
      process.env[key] = item
    }
    loaded.push(envPath)
  }

  return loaded
}

export function trimTrailingSlash(input) {
  return String(input || '').replace(/\/+$/, '')
}

function tenantDomainSuffix() {
  return value('HZY_TENANT_DOMAIN_SUFFIX', 'huizhi.yun')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase()
}

function isTenantDomainUrl(input) {
  const normalized = trimTrailingSlash(input)
  if (!normalized) return false

  let hostname = ''
  try {
    hostname = new URL(normalized).hostname.toLowerCase()
  } catch {
    return false
  }

  const suffix = tenantDomainSuffix()
  if (!hostname || !suffix || !hostname.endsWith(`.${suffix}`)) {
    return false
  }

  const subdomain = hostname.slice(0, -1 * (`.${suffix}`).length)
  return Boolean(subdomain && !subdomain.includes('.') && subdomain !== 'console')
}

function tenantNeutralConsoleUrl(name, configured, fallback) {
  const normalized = trimTrailingSlash(configured)
  if (normalized && isTenantDomainUrl(normalized)) {
    console.warn(`Ignoring ${name}=${normalized}; shared Cloudflare app Workers must not bake tenant hosts into Console URLs.`)
    return fallback
  }

  return normalized || fallback
}

function tenantNeutralPublicUrl(name, configured) {
  const normalized = trimTrailingSlash(configured)
  if (normalized && isTenantDomainUrl(normalized)) {
    console.warn(`Ignoring ${name}=${normalized}; shared Cloudflare app Workers must not bake tenant hosts into public URLs.`)
    return ''
  }

  return normalized
}

export function defaultWorkersDev(prefix, routePattern, zoneName, fallback = '') {
  return value(`HZY_${prefix}_WORKERS_DEV`, fallback || (routePattern && zoneName ? 'false' : 'true')) !== 'false'
}

function filterVars(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, item]) => item !== undefined && item !== null && String(item) !== '')
  )
}

function normalizeBasePath(value) {
  const raw = String(value || '/').trim()
  if (!raw || raw === '/') return '/'
  const withStart = raw.startsWith('/') ? raw : `/${raw}`
  return withStart.endsWith('/') ? withStart : `${withStart}/`
}

function routeConfig(routePattern, zoneName) {
  return routePattern && zoneName
    ? {
        routes: [
          {
            pattern: routePattern,
            zone_name: zoneName
          }
        ]
      }
    : {}
}

function hyperdriveConfig(profile, hyperdriveEnv, hyperdriveId, missingMessage) {
  if (profile !== 'managed-cloud-direct-db') return {}

  if (profile === 'managed-cloud-direct-db' && !hyperdriveId) {
    console.error(missingMessage || `Missing ${hyperdriveEnv}. Create Hyperdrive first, then export its id before deploy.`)
    process.exit(1)
  }

  return hyperdriveId
    ? {
        hyperdrive: [
          {
            binding: 'HYPERDRIVE',
            id: hyperdriveId
          }
        ]
      }
    : {}
}

function requestedDeploymentProfile(options) {
  return value(
    'HZY_DEPLOYMENT_PROFILE',
    value('NUXT_PUBLIC_DEPLOYMENT_PROFILE', value('DEPLOYMENT_PROFILE', options.defaultProfile || 'managed-cloud-direct-db'))
  )
}

function explicitDeploymentProfile() {
  return value('HZY_DEPLOYMENT_PROFILE') || value('NUXT_PUBLIC_DEPLOYMENT_PROFILE') || value('DEPLOYMENT_PROFILE')
}

function resolveDeploymentProfile(options, appCode) {
  const fixedProfile = String(options.fixedDeploymentProfile || '').trim()
  const profile = fixedProfile || requestedDeploymentProfile(options)

  if (!MANAGED_CLOUD_PROFILES.has(profile)) {
    console.error(`Unsupported Cloudflare deployment profile: ${profile}`)
    process.exit(1)
  }

  if (fixedProfile) {
    const requestedProfile = explicitDeploymentProfile()
    if (requestedProfile && requestedProfile !== fixedProfile) {
      console.warn(`Ignoring Cloudflare deployment profile ${requestedProfile}; ${appCode} is locked to ${fixedProfile}.`)
    }
  }

  return profile
}

function assertNoDatabaseBindings(config, appCode) {
  const dbVars = Object.keys(config.vars || {}).filter(key => key === 'DB_NAME' || key === 'DB_CONNECTION_LIMIT' || key.startsWith('DB_'))
  const hasHyperdrive = Array.isArray(config.hyperdrive) && config.hyperdrive.length

  if (dbVars.length || hasHyperdrive) {
    console.error(`${appCode} Cloudflare config must not include direct database bindings. Remove: ${[
      ...dbVars,
      ...(hasHyperdrive ? ['hyperdrive'] : [])
    ].join(', ')}`)
    process.exit(1)
  }
}

export function renderNuxtWorkerConfig(options) {
  const rootDir = resolve(dirname(fileURLToPath(options.metaUrl)), '..')
  const repoRoot = resolve(rootDir, '..')
  const prefix = options.envPrefix
  const appCode = options.appCode
  const defaultOutputPath = resolve(rootDir, '.wrangler.generated.jsonc')
  const outputPath = resolveOptionalEnvPath(
    value(`HZY_${prefix}_WRANGLER_OUTPUT`, value('HZY_NUXT_WORKER_WRANGLER_OUTPUT', defaultOutputPath)),
    rootDir,
    repoRoot
  )
  const explicitEnvFiles = value('HZY_CLOUDFLARE_ENV_FILE')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const loadedEnvFiles = loadEnvFiles([
    {
      path: resolve(repoRoot, 'deploy/dev-stack/env.staging'),
      skipKeys: [
        'HZY_DEPLOYMENT_PUBLIC_URL',
        'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL',
        'HZY_APP_HOME_URL',
        'NUXT_PUBLIC_APP_HOME_URL',
        'HZY_MANAGED_CONSOLE_URL',
        'HZY_CONSOLE_URL',
        'HZY_CONSOLE_API_URL',
        'HZY_CONSOLE_TOKEN_URL',
        'HZY_CONSOLE_RUNTIME_API_URL',
        'NUXT_PUBLIC_CONSOLE_URL',
        'NUXT_PUBLIC_ACCOUNT_URL'
      ]
    },
    resolve(rootDir, '.env.cloudflare'),
    resolve(rootDir, '.env.cloudflare.local'),
    ...explicitEnvFiles
  ], rootDir, repoRoot)

  if (loadedEnvFiles.length) {
    console.info(`Loaded Cloudflare env: ${loadedEnvFiles.join(', ')}`)
  }

  const profile = resolveDeploymentProfile(options, appCode)

  const routePattern = value(`HZY_${prefix}_ROUTE_PATTERN`)
  const zoneName = value(`HZY_${prefix}_ZONE_NAME`)
  const workersDev = defaultWorkersDev(prefix, routePattern, zoneName, options.workersDevDefault)
  const sharedManagedAgentWorker = profile === 'managed-cloud-agent'
    && options.fixedDeploymentProfile === 'managed-cloud-agent'
    && options.includeDbVars === false
  const rawPublicUrl = value('HZY_DEPLOYMENT_PUBLIC_URL', options.defaultPublicUrl || '')
  const publicUrl = sharedManagedAgentWorker
    ? tenantNeutralPublicUrl('HZY_DEPLOYMENT_PUBLIC_URL', rawPublicUrl)
    : trimTrailingSlash(rawPublicUrl)
  const defaultConsoleUrl = sharedManagedAgentWorker
    ? tenantNeutralConsoleUrl('HZY_MANAGED_CONSOLE_URL', value('HZY_MANAGED_CONSOLE_URL'), DEFAULT_MANAGED_CONSOLE_URL)
    : value('HZY_MANAGED_CONSOLE_URL', DEFAULT_MANAGED_CONSOLE_URL)
  const consoleUrl = sharedManagedAgentWorker
    ? tenantNeutralConsoleUrl('HZY_CONSOLE_URL', value('HZY_CONSOLE_URL'), defaultConsoleUrl)
    : trimTrailingSlash(value('HZY_CONSOLE_URL', defaultConsoleUrl || publicUrl))
  const consoleApiUrl = sharedManagedAgentWorker
    ? tenantNeutralConsoleUrl('HZY_CONSOLE_API_URL', value('HZY_CONSOLE_API_URL'), consoleUrl)
    : trimTrailingSlash(value('HZY_CONSOLE_API_URL', consoleUrl))
  const consoleRuntimeApiUrl = sharedManagedAgentWorker
    ? tenantNeutralConsoleUrl('HZY_CONSOLE_RUNTIME_API_URL', value('HZY_CONSOLE_RUNTIME_API_URL'), consoleUrl)
    : trimTrailingSlash(value('HZY_CONSOLE_RUNTIME_API_URL', ''))
  const appBasePath = normalizeBasePath(value('HZY_APP_BASE_PATH', options.defaultBasePath || `/${appCode}/`))
  const appHomeUrl = sharedManagedAgentWorker
    ? tenantNeutralPublicUrl('HZY_APP_HOME_URL', value('HZY_APP_HOME_URL')) || (publicUrl ? `${publicUrl}${appBasePath}` : '')
    : value('HZY_APP_HOME_URL', publicUrl ? `${publicUrl}${appBasePath}` : '')
  const hyperdriveEnv = options.hyperdriveEnv || `HZY_${prefix}_HYPERDRIVE_ID`
  const hyperdriveId = value(hyperdriveEnv)

  const context = {
    profile,
    publicUrl,
    appBasePath,
    appHomeUrl,
    appCode,
    prefix
  }

  const config = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: value(`HZY_${prefix}_WORKER_NAME`, options.defaultWorkerName || `hzy-${appCode}`),
    main: '.output/server/index.mjs',
    compatibility_date: value(`HZY_${prefix}_COMPATIBILITY_DATE`, options.compatibilityDate || '2026-05-24'),
    compatibility_flags: ['nodejs_compat'],
    assets: {
      directory: '.output/public',
      binding: 'ASSETS'
    },
    observability: {
      enabled: true
    },
    workers_dev: workersDev,
    ...routeConfig(routePattern, zoneName),
    ...hyperdriveConfig(profile, hyperdriveEnv, hyperdriveId, options.missingHyperdriveMessage),
    vars: filterVars({
      NODE_ENV: 'production',
      HZY_CLOUDFLARE_BUILD: 'true',
      HZY_DEPLOYMENT_PROFILE: profile,
      NUXT_PUBLIC_DEPLOYMENT_PROFILE: profile,
      HZY_APP_CODE: appCode,
      NUXT_PUBLIC_APP_CODE: appCode,
      HZY_APP_BASE_PATH: appBasePath,
      NUXT_PUBLIC_APP_BASE_PATH: appBasePath,
      NUXT_APP_BASE_URL: appBasePath,
      HZY_APP_HOME_URL: appHomeUrl,
      NUXT_PUBLIC_APP_HOME_URL: appHomeUrl,
      HZY_DEPLOYMENT_PUBLIC_URL: publicUrl,
      NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL: publicUrl,
      HZY_CONSOLE_URL: consoleUrl,
      HZY_CONSOLE_API_URL: consoleApiUrl,
      HZY_CONSOLE_RUNTIME_API_URL: consoleRuntimeApiUrl,
      NUXT_PUBLIC_CONSOLE_URL: consoleUrl,
      NUXT_PUBLIC_ACCOUNT_URL: consoleUrl,
      HZY_DATA_RUNTIME_AUDIENCE: value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime'),
      HZY_NOTIFICATION_RUNTIME_API_URL: value('HZY_NOTIFICATION_RUNTIME_API_URL', value('HZY_NOTIFICATION_RUNTIME_URL')),
      HZY_NOTIFICATION_RUNTIME_AUDIENCE: value('HZY_NOTIFICATION_RUNTIME_AUDIENCE', 'notification-runtime'),
      HZY_NOTIFICATION_RUNTIME_LEGACY_FALLBACK: value('HZY_NOTIFICATION_RUNTIME_LEGACY_FALLBACK'),
      HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP: 'false',
      ...(options.includeDbVars === false
        ? {}
        : {
            DB_NAME: value('DB_NAME', options.defaultDbName || `hzy_${appCode}`),
            DB_CONNECTION_LIMIT: value('DB_CONNECTION_LIMIT', '2')
          }),
      NUXT_PUBLIC_APP_NAME: options.appName,
      NUXT_PUBLIC_APP_DISPLAY_NAME: options.appDisplayName || options.appName,
      NUXT_PUBLIC_APP_ICON: options.appIcon,
      ...(typeof options.extraVars === 'function' ? options.extraVars(context) : options.extraVars || {})
    })
  }

  if (options.forbidDatabaseBindings) {
    assertNoDatabaseBindings(config, appCode)
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`)
  console.info(`Generated ${outputPath} (${profile})`)
}
