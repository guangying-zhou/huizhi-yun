import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

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
  appName: '汇智云财务',
  appDisplayName: '汇智云财务',
  appIcon: 'i-lucide-receipt-text',
  extraVars: {
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_FINANCE_DATA_ACCESS_MODE: value('HZY_FINANCE_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_FINANCE_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT'))
  }
})
