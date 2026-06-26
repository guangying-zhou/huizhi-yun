import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'CODOCS',
  appCode: 'codocs',
  defaultWorkerName: 'hzy-codocs',
  defaultBasePath: '/codocs/',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  includeDbVars: false,
  forbidDatabaseBindings: true,
  compatibilityDate: '2026-05-24',
  appName: '汇智云文档',
  appDisplayName: '汇智云文档',
  appIcon: 'i-lucide-files',
  extraVars: ({ publicUrl, appBasePath }) => ({
    HZY_DATA_ACCESS_MODE: value('HZY_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_CODOCS_DATA_ACCESS_MODE: value('HZY_CODOCS_DATA_ACCESS_MODE', 'tenant-runtime'),
    HZY_TENANT_RUNTIME_URL: value('HZY_TENANT_RUNTIME_URL', value('HZY_CODOCS_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL'))),
    HZY_TENANT_RUNTIME_AUDIENCE: value('HZY_TENANT_RUNTIME_AUDIENCE', value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')),
    HZY_TENANT_RUNTIME_TENANT: value('HZY_TENANT_RUNTIME_TENANT', value('HZY_DATA_RUNTIME_TENANT')),
    HZY_TENANT_RUNTIME_DEPLOYMENT: value('HZY_TENANT_RUNTIME_DEPLOYMENT', value('HZY_DATA_RUNTIME_DEPLOYMENT')),
    HZY_OBJECT_STORAGE_PROVIDER: value('HZY_OBJECT_STORAGE_PROVIDER', 'aliyun-oss-s3'),
    HZY_OBJECT_STORAGE_FORCE_PATH_STYLE: value('HZY_OBJECT_STORAGE_FORCE_PATH_STYLE'),
    NUXT_PUBLIC_COLLABORATION_URL: value('NUXT_PUBLIC_COLLABORATION_URL', publicUrl ? `${publicUrl.replace(/^http/i, 'ws')}${appBasePath}ws` : `${appBasePath}ws`)
  })
})
