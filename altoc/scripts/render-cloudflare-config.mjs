import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

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
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT'))
  }
})
