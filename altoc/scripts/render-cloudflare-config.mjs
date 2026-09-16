import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

function enabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(value(name).toLowerCase())
}

function defaultCrons() {
  const operationDrain = enabled('HZY_ALTOC_SCHEDULED_DRAIN_ENABLED')
  const receivableDue = enabled('HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED')
  if (!operationDrain && !receivableDue) return []
  const required = {
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_ALTOC_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT'))
  }
  const missing = Object.entries(required).filter(([, current]) => !current).map(([name]) => name)
  if (missing.length) {
    throw new Error(`Altoc scheduled drain requires explicit binding vars: ${missing.join(', ')}`)
  }
  if (receivableDue && value('HZY_ALTOC_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')) !== 'altoc.runtime') {
    throw new Error('Altoc receivable due notifications require HZY_ALTOC_SERVICE_CLIENT_ID=altoc.runtime')
  }
  return [
    ...(operationDrain ? ['*/5 * * * *'] : []),
    ...(receivableDue ? ['*/15 * * * *'] : [])
  ]
}

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'ALTOC',
  appCode: 'altoc',
  defaultWorkerName: 'hzy-altoc',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  defaultBasePath: '/altoc/',
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
      binding: 'HZY_FINANCE_SERVICE',
      service: value('HZY_FINANCE_WORKER_NAME', 'hzy-finance')
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
      binding: 'HZY_CODOCS_SERVICE',
      service: value('HZY_CODOCS_WORKER_NAME', 'hzy-codocs')
    }
  ],
  workersDevDefault: 'true',
  appName: '汇智云经营',
  appDisplayName: '汇智云经营',
  appIcon: 'i-lucide-handshake',
  extraVars: {
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_ALTOC_DATA_ACCESS_MODE: value('HZY_ALTOC_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_ALTOC_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_ALTOC_SERVICE_CLIENT_ID: value('HZY_ALTOC_SERVICE_CLIENT_ID', value('HZY_SERVICE_CLIENT_ID')),
    HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED: value('HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED', 'false')
  }
})
