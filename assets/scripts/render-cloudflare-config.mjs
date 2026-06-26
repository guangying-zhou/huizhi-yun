import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

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
  appName: '汇智云资产',
  appDisplayName: '汇智云资产',
  appIcon: 'i-lucide-boxes',
  extraVars: () => ({
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_ASSETS_DATA_ACCESS_MODE: value('HZY_ASSETS_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL')),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_OBJECT_STORAGE_PROVIDER: value('HZY_OBJECT_STORAGE_PROVIDER', 'aliyun-oss-s3'),
    HZY_OBJECT_STORAGE_FORCE_PATH_STYLE: value('HZY_OBJECT_STORAGE_FORCE_PATH_STYLE')
  })
})
