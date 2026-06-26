import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

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
  appName: 'People 人员',
  appDisplayName: 'People 人员',
  appIcon: 'i-lucide-users',
  extraVars: {
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_PEOPLE_DATA_ACCESS_MODE: value('HZY_PEOPLE_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_PEOPLE_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT'))
  }
})
