import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

function enabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(value(name).toLowerCase())
}

function defaultCrons() {
  const dueNotificationsEnabled = enabled('HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED')
  if (!dueNotificationsEnabled && !enabled('HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED')) return []
  const required = {
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_FINANCE_TENANT_RUNTIME_URL', value('HZY_FINANCE_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL')))),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_FINANCE_SERVICE_CLIENT_ID: value('HZY_FINANCE_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID'))
  }
  const missing = Object.entries(required).filter(([, current]) => !current).map(([name]) => name)
  if (missing.length) throw new Error(`Finance due notifications require explicit binding vars: ${missing.join(', ')}`)
  if (dueNotificationsEnabled && required.HZY_FINANCE_SERVICE_CLIENT_ID !== 'finance.runtime') {
    throw new Error('Finance due notifications require HZY_FINANCE_SERVICE_CLIENT_ID=finance.runtime.')
  }
  return ['*/15 * * * *']
}

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'FINANCE',
  appCode: 'finance',
  defaultWorkerName: 'hzy-finance',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  defaultBasePath: '/finance/',
  includeDbVars: false,
  forbidDatabaseBindings: true,
  compatibilityDate: '2026-05-23',
  crons: defaultCrons,
  services: [
    {
      binding: 'HZY_CONSOLE_SERVICE',
      service: value('HZY_CONSOLE_WORKER_NAME', 'hzy-console-prod')
    },
    // 走查 ISSUE-B-024：应用之间此前没有任何 Service Binding，跨应用调用走
    // 租户公网地址，在 Worker 之间被 WAF 静默拦掉（与 Console 同因）。
    // 目标 Worker 名沿用 HZY_<APP>_WORKER_NAME，默认 hzy-<app>。
    {
      binding: 'HZY_ALTOC_SERVICE',
      service: value('HZY_ALTOC_WORKER_NAME', 'hzy-altoc')
    },
    {
      binding: 'HZY_AIMS_SERVICE',
      service: value('HZY_AIMS_WORKER_NAME', 'hzy-aims')
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
      binding: 'HZY_WORKFLOW_SERVICE',
      service: value('HZY_WORKFLOW_WORKER_NAME', 'hzy-workflow')
    }
  ],
  appName: '汇智云财务',
  appDisplayName: '汇智云财务',
  appIcon: 'i-lucide-receipt-text',
  extraVars: {
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_FINANCE_DATA_ACCESS_MODE: value('HZY_FINANCE_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_FINANCE_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_FINANCE_SERVICE_CLIENT_ID: value('HZY_FINANCE_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')),
    HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED: value('HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED', 'false'),
    HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED: value('HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED', 'false')
  }
})
