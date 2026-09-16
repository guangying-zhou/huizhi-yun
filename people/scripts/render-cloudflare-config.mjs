import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

function enabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(value(name).toLowerCase())
}

function defaultCrons() {
  if (!enabled('HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED')
    && !enabled('HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED')
    && !enabled('HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED')
    && !enabled('HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED')) return []
  const required = {
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_PEOPLE_TENANT_RUNTIME_URL', value('HZY_PEOPLE_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL')))),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_PEOPLE_SERVICE_CLIENT_ID: value('HZY_PEOPLE_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID'))
  }
  if (enabled('HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED')) {
    required.HZY_CONSOLE_TARGET_DEPLOYMENT = value('HZY_CONSOLE_TARGET_DEPLOYMENT')
  }
  if (enabled('HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED') && required.HZY_PEOPLE_SERVICE_CLIENT_ID !== 'people.runtime') {
    throw new Error('People offboarding due notifications require HZY_PEOPLE_SERVICE_CLIENT_ID=people.runtime')
  }
  const missing = Object.entries(required).filter(([, current]) => !current).map(([name]) => name)
  if (missing.length) {
    throw new Error(`People scheduled lifecycle delivery requires explicit binding vars: ${missing.join(', ')}`)
  }
  return ['*/15 * * * *']
}

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'PEOPLE',
  appCode: 'people',
  defaultWorkerName: 'hzy-people',
  defaultBasePath: '/people/',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  includeDbVars: false,
  forbidDatabaseBindings: true,
  compatibilityDate: '2026-06-15',
  crons: defaultCrons,
  services: [
    {
      binding: 'HZY_CONSOLE_SERVICE',
      service: value('HZY_CONSOLE_WORKER_NAME', 'hzy-console-prod')
    }
  ],
  appName: '汇智云HR',
  appDisplayName: '汇智云HR',
  appIcon: 'i-lucide-users',
  extraVars: () => ({
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_PEOPLE_DATA_ACCESS_MODE: value('HZY_PEOPLE_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_PEOPLE_TENANT_RUNTIME_URL', value('HZY_PEOPLE_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL')))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_CONSOLE_TARGET_DEPLOYMENT: value('HZY_CONSOLE_TARGET_DEPLOYMENT'),
    HZY_PEOPLE_SERVICE_CLIENT_ID: value('HZY_PEOPLE_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')),
    HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED: value('HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED', 'false'),
    HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED: value('HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED', 'false'),
    HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED: value('HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED', 'false'),
    HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED: value('HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED', 'false')
  })
})
