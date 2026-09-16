import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

function enabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(value(name).toLowerCase())
}

function defaultCrons() {
  if (!enabled('HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED') && !enabled('HZY_ASSETS_STATUS_OPERATIONS_ENABLED')) return []
  const required = {
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_ASSETS_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT'))
  }
  const missing = Object.entries(required).filter(([, current]) => !current).map(([name]) => name)
  if (missing.length) {
    throw new Error(`Assets due notifications require explicit binding vars: ${missing.join(', ')}`)
  }
  if (enabled('HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED') && value('HZY_ASSETS_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')) !== 'assets.runtime') {
    throw new Error('Assets due notifications require HZY_ASSETS_SERVICE_CLIENT_ID=assets.runtime')
  }
  return ['*/15 * * * *']
}

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'ASSETS',
  appCode: 'assets',
  defaultWorkerName: 'hzy-assets',
  defaultBasePath: '/assets/',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  includeDbVars: false,
  forbidDatabaseBindings: true,
  compatibilityDate: '2026-05-24',
  crons: defaultCrons,
  services: [
    {
      binding: 'HZY_CONSOLE_SERVICE',
      service: value('HZY_CONSOLE_WORKER_NAME', 'hzy-console-prod')
    }
  ],
  appName: '汇智云资产',
  appDisplayName: '汇智云资产',
  appIcon: 'i-lucide-boxes',
  extraVars: () => ({
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_ASSETS_DATA_ACCESS_MODE: value('HZY_ASSETS_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_ASSETS_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_ASSETS_SERVICE_CLIENT_ID: value('HZY_ASSETS_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')),
    HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED: value('HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED', 'false'),
    HZY_ASSETS_STATUS_OPERATIONS_ENABLED: value('HZY_ASSETS_STATUS_OPERATIONS_ENABLED', 'false'),
    HZY_OBJECT_STORAGE_PROVIDER: value('HZY_OBJECT_STORAGE_PROVIDER', 'aliyun-oss-s3'),
    HZY_OBJECT_STORAGE_FORCE_PATH_STYLE: value('HZY_OBJECT_STORAGE_FORCE_PATH_STYLE')
  })
})
