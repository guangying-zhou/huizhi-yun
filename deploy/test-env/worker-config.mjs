import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { localOrigin, localHostname } from './worker-origin.mjs'
export { localOrigin } from './worker-origin.mjs'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const stateDir = resolve(root, 'deploy/test-env/.local-workers')
export const workerNames = Object.freeze({ gateway: 'hzy-local-gateway', console: 'hzy-local-console', people: 'hzy-local-people' })
export const wranglerVersion = '4.110.0'

// Intentionally does not read .env, .env.cloudflare or production renderers.
// Runtime secrets are provisioned separately, never compiled into the client.
export function appConfig(app) {
  if (!['console', 'people'].includes(app)) throw Error('Unsupported local Worker')
  const base = app === 'console' ? '/' : '/people/'
  const profile = app === 'console' ? 'managed-cloud-runtime' : 'managed-cloud-agent'
  const vars = {
    NODE_ENV: 'production', HZY_CLOUDFLARE_BUILD: 'true', HZY_CLOUDFLARE_RUNTIME: 'true',
    HZY_APP_CODE: app, NUXT_PUBLIC_APP_CODE: app,
    HZY_DEPLOYMENT_PROFILE: profile, NUXT_PUBLIC_DEPLOYMENT_PROFILE: profile,
    HZY_APP_BASE_PATH: base, NUXT_PUBLIC_APP_BASE_PATH: base, NUXT_APP_BASE_URL: base,
    HZY_DEPLOYMENT_PUBLIC_URL: localOrigin, NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL: localOrigin,
    HZY_PLATFORM_URL: 'https://hzy.wiztek.cn', HZY_PLATFORM_ENVIRONMENT: 'test',
    HZY_PLATFORM_TENANT_CODE: 'C000001',
    HZY_PLATFORM_DEPLOYMENT_CODE: app === 'console' ? 'wiztek-test-console' : 'C000001-test-people',
    HZY_CONSOLE_URL: localOrigin, HZY_CONSOLE_API_URL: localOrigin,
    HZY_CONSOLE_RUNTIME_API_URL: localOrigin, HZY_CONSOLE_TOKEN_URL: `${localOrigin}/oauth/token`,
    NUXT_PUBLIC_CONSOLE_URL: localOrigin, NUXT_PUBLIC_ACCOUNT_URL: localOrigin,
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'true', HZY_CONSOLE_DEV_POLICY_BYPASS: 'false',
    HZY_AUTH_MODE: 'console', HZY_LEGACY_AUTH_BRIDGE: 'false',
    HZY_PLATFORM_HEARTBEAT_ENABLED: 'false', HZY_BACKGROUND_JOBS_ENABLED: 'false',
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false', HZY_COLLAB_ENABLED: 'false',
    HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP: 'false',
    // Workflow is not part of this local topology; do not poll its pending badge.
    NUXT_PUBLIC_WORKFLOW_ENABLED: 'false',
    NUXT_CONSOLE_USER_APPLICATIONS_TIMEOUT_MS: '15000',
    HZY_PERF_TIMING_ENABLED: 'true',
    HZY_DATA_ACCESS_MODE: 'tenant-runtime'
  }
  if (app === 'console') Object.assign(vars, {
    HZY_PLATFORM_RUNTIME_ENABLED: 'true', HZY_PLATFORM_BUNDLE_CACHE_DIR: 'memory://local-console',
    HZY_PLATFORM_BUNDLE_ALLOW_LEGACY_CACHE: 'false', HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_ENABLED: 'true',
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'runtime', HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '300000', HZY_PLATFORM_BUNDLE_CACHE_SCOPE: 'local-workers-console-test',
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: 'false', HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'true',
    HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE: 'upsert', HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false',
    HZY_CONSOLE_PLATFORM_LIFECYCLE_SYNC_ENABLED: 'false', CONSOLE_COLLAB_MODE: 'disabled',
    CONSOLE_OIDC_ISSUER: localOrigin, HZY_CONSOLE_ACTIVATION_MODE: 'managed-cloud-multitenant',
    HZY_CONSOLE_RUN_MODE: 'prod'
  })
  else Object.assign(vars, {
    HZY_PEOPLE_DATA_ACCESS_MODE: 'tenant-runtime', HZY_PEOPLE_SERVICE_CLIENT_ID: 'people.runtime',
    HZY_CONSOLE_TARGET_DEPLOYMENT: 'wiztek-test-console',
    HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED: 'false', HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED: 'false',
    HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED: 'false',
    HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'false'
  })
  return {
    name: workerNames[app], main: './output/server/index.mjs',
    compatibility_date: app === 'console' ? '2026-05-23' : '2026-06-15',
    compatibility_flags: ['nodejs_compat'], workers_dev: false,
    assets: { directory: app === 'people' ? './assets' : './output/public', binding: 'ASSETS' },
    ...(app === 'people' ? { services: [{ binding: 'HZY_CONSOLE_SERVICE', service: workerNames.console }] } : {}),
    vars
  }
}

export function gatewayConfig(mode = 'smoke') {
  if (!['smoke', 'integration'].includes(mode)) throw Error('Unsupported local mode')
  return {
    name: workerNames.gateway, main: '../../worker-gateway.mjs',
    compatibility_date: '2026-05-23', compatibility_flags: ['nodejs_compat'], workers_dev: false,
    services: ['console', 'people'].map(app => ({ binding: `HZY_${app.toUpperCase()}_SERVICE`, service: workerNames[app] })),
    vars: {
      HZY_LOCAL_WORKER_MODE: mode, HZY_TENANT_DOMAIN_SUFFIX: 'isme.dev', HZY_ALLOWED_TENANTS: 'C000001',
      HZY_POLICY_SYNC_HOSTS: localHostname,
      ...(mode === 'integration' ? { HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/resolve' } : {}),
      HZY_CONSOLE_ORIGIN: 'https://console.local.invalid', HZY_PEOPLE_ORIGIN: 'https://people.local.invalid',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { [localHostname]: {
        tenantCode: 'C000001', deploymentCode: 'wiztek-test-console', environment: 'test',
        ...(mode === 'integration' ? { dataRuntime: { endpoint: 'https://local-runtime.invalid', runtimeCode: 'c000001-test-tenant-runtime', audience: 'data-runtime' } } : {}),
        apps: { console: { deploymentCode: 'wiztek-test-console' }, people: { deploymentCode: 'C000001-test-people' } }
      } } })
    }
  }
}

export function validateLocalConfig(config) {
  if (!Object.values(workerNames).includes(config.name)) throw Error('Non-local Worker name')
  for (const key of ['routes', 'route', 'd1_databases', 'hyperdrive', 'kv_namespaces', 'queues', 'triggers']) {
    if (key in config) throw Error(`Remote resource or trigger forbidden: ${key}`)
  }
  if (config.r2_buckets) throw Error('Policy persistence belongs to Tenant Runtime, not R2')
  if (config.workers_dev !== false) throw Error('Publishing must be disabled')
  for (const service of config.services || []) {
    if (!Object.values(workerNames).includes(service.service) || service.remote || service.environment)
      throw Error('Non-local Service Binding')
    if (service.binding === 'HZY_PLATFORM_SERVICE') throw Error('Platform must use test HTTPS')
  }
  for (const [key, value] of Object.entries(config.vars || {})) {
    // Only the exact approved developer hostname is exempt, not other isme.dev apps.
    const destination = String(value).replace(/(?<![a-z0-9.-])hzy0\.isme\.dev(?![a-z0-9.-])/g, '')
    if (key !== 'HZY_TENANT_DOMAIN_SUFFIX' && /huizhi\.yun|workers\.dev|isme\.dev/i.test(destination)) throw Error(`Production destination: ${key}`)
    if (key === 'HZY_TENANT_DOMAIN_SUFFIX' && value !== 'isme.dev') throw Error('Unexpected test domain suffix')
    if (/(?:SECRET|PASSWORD|PRIVATE_KEY|INTERNAL_TOKEN|RUNTIME_TOKEN|LICENSE_TOKEN)$/.test(key)) throw Error('Secret in public config')
  }
  if (config.name === workerNames.people && !config.services?.some(s => s.binding === 'HZY_CONSOLE_SERVICE' && s.service === workerNames.console))
    throw Error('People requires local Console Binding')
  return config
}
