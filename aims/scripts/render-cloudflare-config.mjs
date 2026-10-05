import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

function enabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(value(name).toLowerCase())
}

function defaultCrons() {
  const drainEnabled = enabled('HZY_AIMS_SCHEDULED_DRAIN_ENABLED')
  const dueNotificationsEnabled = enabled('HZY_AIMS_DUE_NOTIFICATIONS_ENABLED')
  if (!drainEnabled && !dueNotificationsEnabled) return ['15 2 * * *']
  const required = {
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_AIMS_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT'))
  }
  if (drainEnabled) {
    required.HZY_CODOCS_TARGET_DEPLOYMENT = value('HZY_CODOCS_TARGET_DEPLOYMENT')
  }
  const missing = Object.entries(required).filter(([, current]) => !current).map(([name]) => name)
  if (missing.length) {
    throw new Error(`Aims scheduled work requires explicit binding vars: ${missing.join(', ')}`)
  }
  if (dueNotificationsEnabled && value('HZY_AIMS_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')) !== 'aims.runtime') {
    throw new Error('Aims due notifications require HZY_AIMS_SERVICE_CLIENT_ID=aims.runtime')
  }
  return [
    ...(drainEnabled ? ['*/5 * * * *'] : []),
    ...(dueNotificationsEnabled ? ['*/15 * * * *'] : []),
    '15 2 * * *'
  ]
}

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'AIMS',
  appCode: 'aims',
  defaultWorkerName: 'hzy-aims',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  defaultBasePath: '/aims/',
  includeDbVars: false,
  forbidDatabaseBindings: true,
  compatibilityDate: '2026-05-24',
  crons: defaultCrons,
  services: [
    {
      binding: 'HZY_CONSOLE_SERVICE',
      service: value('HZY_CONSOLE_WORKER_NAME', 'hzy-console-prod')
    },
    {
      binding: 'HZY_ALTOC_SERVICE',
      service: value('HZY_ALTOC_WORKER_NAME', 'hzy-altoc')
    },
    {
      binding: 'HZY_ASSETS_SERVICE',
      service: value('HZY_ASSETS_WORKER_NAME', 'hzy-assets')
    },
    {
      binding: 'HZY_PEOPLE_SERVICE',
      service: value('HZY_PEOPLE_WORKER_NAME', 'hzy-people')
    },
    {
      binding: 'HZY_FINANCE_SERVICE',
      service: value('HZY_FINANCE_WORKER_NAME', 'hzy-finance')
    },
    {
      binding: 'HZY_CODOCS_SERVICE',
      service: value('HZY_CODOCS_WORKER_NAME', 'hzy-codocs')
    }
  ],
  appName: '汇智云项目',
  appDisplayName: '汇智云项目',
  appIcon: 'i-lucide-package',
  extraVars: ({ publicUrl }) => ({
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_AIMS_DATA_ACCESS_MODE: value('HZY_AIMS_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_AIMS_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_CODOCS_TARGET_DEPLOYMENT: value('HZY_CODOCS_TARGET_DEPLOYMENT'),
    HZY_AIMS_SERVICE_CLIENT_ID: value('HZY_AIMS_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')),
    HZY_AIMS_DUE_NOTIFICATIONS_ENABLED: value('HZY_AIMS_DUE_NOTIFICATIONS_ENABLED', 'false'),
    NUXT_PUBLIC_CODOCS_URL: value('NUXT_PUBLIC_CODOCS_URL', publicUrl ? `${publicUrl}/codocs/` : '/codocs/')
  })
})
