const fs = require('node:fs')
const path = require('node:path')

const stackDir = __dirname
const rootDir = path.resolve(stackDir, '../..')
const stackEnv = process.env.HZY_DEV_STACK_ENV || 'local'
const envFile = path.join(stackDir, `env.${stackEnv}`)
const envExampleFile = path.join(stackDir, `env.${stackEnv}.example`)
const loadedEnv = readEnvFile(fs.existsSync(envFile) ? envFile : envExampleFile)
const pnpmBin = process.env.HZY_DEV_STACK_PNPM || 'pnpm'

const publicUrl = trimTrailingSlash(stackEnvValue('HZY_DEPLOYMENT_PUBLIC_URL') || 'http://localhost:3180')
const publicHost = hostFromUrl(publicUrl)
const allApps = ['console', 'codocs', 'aims', 'altoc', 'assets', 'workflow', 'finance']
const defaultApps = ['console', 'workflow']
const enabledApps = new Set(
  String(stackEnvValue('HZY_DEV_STACK_APPS') || defaultApps.join(','))
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
)

const portMap = {
  console: 3100,
  codocs: 3101,
  aims: 3102,
  altoc: 3103,
  assets: 3104,
  workflow: 3105,
  finance: 3106
}

const hmrPortMap = {
  console: 3170,
  codocs: 3171,
  aims: 3172,
  altoc: 3173,
  assets: 3174,
  workflow: 3175,
  finance: 3176
}

const basePathMap = {
  console: '/',
  codocs: '/codocs/',
  aims: '/aims/',
  altoc: '/altoc/',
  assets: '/assets/',
  workflow: '/workflow/',
  finance: '/finance/'
}

const dbNameMap = {
  console: 'hzy_console',
  codocs: 'hzy_codocs',
  aims: 'hzy_aims',
  altoc: 'hzy_altoc',
  assets: 'hzy_assets',
  workflow: 'hzy_workflow',
  finance: 'hzy_finance'
}

const displayNameMap = {
  console: '汇智云控制台',
  codocs: '汇智云文档',
  aims: '汇智云项目',
  altoc: '汇智云营销',
  assets: '汇智云资产',
  workflow: '汇智云流程',
  finance: '汇智云财务'
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const result = {}
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!value) continue
    result[key] = value
  }
  return result
}

function stackEnvValue(key) {
  const raw = process.env[key] || loadedEnv[key]
  if (raw == null) return ''
  const value = String(raw).trim()
  if (!value || value === '""' || value === "''") return ''
  return value
}

function stackEnvFlag(key) {
  return stackEnvValue(key) === 'true'
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname
  } catch {
    return ''
  }
}

function splitList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeAllowedHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (/^https?:\/\//i.test(raw)) {
    return hostFromUrl(raw)
  }

  return raw
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

function publicUrlObject(value) {
  try {
    return new URL(String(value || ''))
  } catch {
    return null
  }
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function publicHmrEnv() {
  const url = publicUrlObject(publicUrl)
  if (!url || isLocalHost(url.hostname)) return {}

  const protocol = url.protocol === 'https:' ? 'wss' : 'ws'
  const clientPort = url.port || (protocol === 'wss' ? '443' : '80')
  const configuredProtocol = stackEnvValue('NUXT_VITE_HMR_PROTOCOL') || stackEnvValue('VITE_HMR_PROTOCOL') || protocol
  const configuredHost = stackEnvValue('NUXT_VITE_HMR_HOST') || stackEnvValue('VITE_HMR_HOST') || url.hostname
  const configuredClientPort = stackEnvValue('NUXT_VITE_HMR_CLIENT_PORT') || stackEnvValue('VITE_HMR_CLIENT_PORT') || clientPort

  return {
    NUXT_VITE_HMR_PROTOCOL: configuredProtocol,
    VITE_HMR_PROTOCOL: configuredProtocol,
    NUXT_VITE_HMR_HOST: configuredHost,
    VITE_HMR_HOST: configuredHost,
    NUXT_VITE_HMR_CLIENT_PORT: configuredClientPort,
    VITE_HMR_CLIENT_PORT: configuredClientPort
  }
}

function devAllowedHostsEnv() {
  const hosts = new Set()
  const publicAllowedHost = normalizeAllowedHost(publicHost)
  if (publicAllowedHost) hosts.add(publicAllowedHost)

  for (const key of ['HZY_DEV_STACK_ALLOWED_HOSTS', 'NUXT_VITE_ALLOWED_HOSTS', 'VITE_ALLOWED_HOSTS', '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS']) {
    for (const value of splitList(stackEnvValue(key))) {
      const host = normalizeAllowedHost(value)
      if (host) hosts.add(host)
    }
  }

  return [...hosts].join(',')
}

function legacyAdditionalAllowedHost() {
  const explicit = normalizeAllowedHost(stackEnvValue('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS'))
  if (explicit) return explicit

  for (const value of splitList(stackEnvValue('HZY_DEV_STACK_ALLOWED_HOSTS'))) {
    const host = normalizeAllowedHost(value)
    if (host) return host
  }

  return publicHost
}

function appHomeUrl(appCode) {
  const basePath = basePathMap[appCode]
  return basePath === '/' ? `${publicUrl}/` : `${publicUrl}${basePath}`
}

function publicUrlWithPath(pathname) {
  return `${publicUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

function appEnvFile(appCode) {
  return path.join(rootDir, appCode, '.env.dev')
}

function appBaseEnv(appCode) {
  const baseEnv = readEnvFile(appEnvFile(appCode))
  if (shouldInheritAppDbEnv()) return baseEnv

  const sanitized = { ...baseEnv }
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_CONNECTION_LIMIT', 'DB_NAME', 'DB_SSL', 'DB_SSL_CA', 'DB_SSL_REJECT_UNAUTHORIZED']) {
    delete sanitized[key]
  }
  return sanitized
}

function shouldInheritAppDbEnv() {
  return stackEnv !== 'staging' || stackEnvFlag('HZY_DEV_STACK_INHERIT_APP_ENV_DB')
}

function validateStagingDbConfig() {
  if (stackEnv !== 'staging' || shouldInheritAppDbEnv()) return

  const required = ['DB_HOST', 'DB_USER']
  if (!stackEnvFlag('HZY_DEV_STACK_ALLOW_EMPTY_DB_PASSWORD')) {
    required.push('DB_PASSWORD')
  }

  const missing = required.filter(key => !stackEnvValue(key))
  if (missing.length > 0) {
    throw new Error(
      `Staging dev-stack requires explicit database settings in ${envFile}: ${missing.join(', ')}. ` +
      'Do not rely on module .env.dev DB_* values on a shared server.'
    )
  }

  if (stackEnvValue('DB_USER') === 'root' && !stackEnvFlag('HZY_DEV_STACK_ALLOW_ROOT_DB_USER')) {
    throw new Error(
      `Staging dev-stack refuses DB_USER=root from ${envFile}. ` +
      'Create a dedicated runtime MySQL user and grant it access to the hzy_* schemas.'
    )
  }
}

function commonEnv(appCode) {
  const basePath = basePathMap[appCode]
  const appPort = portMap[appCode]
  const baseEnv = appBaseEnv(appCode)
  const devAllowedHosts = devAllowedHostsEnv()
  const env = {
    ...baseEnv,
    ...loadedEnv,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(appPort),
    HZY_APP_CODE: appCode,
    HZY_APP_BASE_PATH: basePath,
    HZY_APP_HOME_URL: appHomeUrl(appCode),
    HZY_DEPLOYMENT_PUBLIC_URL: publicUrl,
    NUXT_APP_BASE_URL: basePath,
    NUXT_PUBLIC_APP_DISPLAY_NAME: displayNameMap[appCode],
    HZY_CONSOLE_URL: stackEnvValue('HZY_CONSOLE_URL') || publicUrl,
    HZY_CONSOLE_API_URL: stackEnvValue('HZY_CONSOLE_API_URL') || publicUrl,
    HZY_WORKFLOW_API_URL: stackEnvValue('HZY_WORKFLOW_API_URL') || `http://127.0.0.1:${portMap.workflow}`,
    DB_NAME: stackEnvValue(`${appCode.toUpperCase()}_DB_NAME`) || stackEnvValue('DB_NAME') || baseEnv.DB_NAME || dbNameMap[appCode],
    NUXT_VITE_HMR_PORT: String(hmrPortMap[appCode]),
    VITE_HMR_PORT: String(hmrPortMap[appCode]),
    NUXT_VITE_ALLOWED_HOSTS: devAllowedHosts,
    VITE_ALLOWED_HOSTS: devAllowedHosts,
    ...publicHmrEnv(),
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: legacyAdditionalAllowedHost()
  }

  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_CONNECTION_LIMIT', 'DB_SSL', 'DB_SSL_CA', 'DB_SSL_REJECT_UNAUTHORIZED']) {
    const value = stackEnvValue(key) || baseEnv[key]
    if (value) {
      env[key] = value
    } else {
      delete env[key]
    }
  }

  if (appCode !== 'console') {
    env.HZY_SERVICE_CLIENT_ID = stackEnvValue(`HZY_SERVICE_CLIENT_${appCode.toUpperCase()}_CLIENT_ID`) || stackEnvValue('HZY_SERVICE_CLIENT_ID') || `${appCode}.runtime`
    env.HZY_SERVICE_CLIENT_SECRET = stackEnvValue(`HZY_SERVICE_CLIENT_${appCode.toUpperCase()}_CLIENT_SECRET`) || stackEnvValue('HZY_SERVICE_CLIENT_SECRET') || ''
    env.HZY_CONSOLE_TOKEN_URL = stackEnvValue('HZY_CONSOLE_TOKEN_URL') || `${publicUrl}/api/v1/console/auth/service-token`
  }

  if (appCode === 'console') {
    env.CONSOLE_COLLAB_MODE = stackEnvValue('CONSOLE_COLLAB_MODE') || 'embedded'
    env.COLLAB_PORT = stackEnvValue('COLLAB_PORT') || '3107'
    env.COLLAB_ADDRESS = stackEnvValue('COLLAB_ADDRESS') || '127.0.0.1'
    env.COLLAB_DB_NAME = stackEnvValue('COLLAB_DB_NAME') || 'hzy_codocs'
    env.SSO_OIDC_REDIRECT_URI = stackEnvValue('SSO_OIDC_REDIRECT_URI') || publicUrlWithPath('/api/auth/oidc-callback')
    env.SSO_OIDC_POST_LOGOUT_REDIRECT_URI = stackEnvValue('SSO_OIDC_POST_LOGOUT_REDIRECT_URI') || publicUrlWithPath('/api/auth/oidc-post-logout')
  }

  if (appCode === 'codocs') {
    env.NUXT_PUBLIC_COLLABORATION_URL = stackEnvValue('NUXT_PUBLIC_COLLABORATION_URL') || `${publicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/codocs/ws`
  }

  return env
}

function appProcess(appCode) {
  return {
    name: `hzy-${appCode}`,
    cwd: rootDir,
    script: pnpmBin,
    args: [
      '--filter',
      appCode,
      'exec',
      'nuxt',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(portMap[appCode])
    ],
    env: commonEnv(appCode),
    interpreter: 'none',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    time: true
  }
}

validateStagingDbConfig()

module.exports = {
  apps: allApps
    .filter(appCode => enabledApps.has(appCode))
    .map(appProcess)
}
