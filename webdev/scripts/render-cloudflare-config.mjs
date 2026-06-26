import { renderNuxtWorkerConfig, value } from '../../deploy/cloudflare/render-nuxt-worker-config.mjs'

renderNuxtWorkerConfig({
  metaUrl: import.meta.url,
  envPrefix: 'WEBDEV',
  appCode: 'webdev',
  defaultWorkerName: 'hzy-webdev',
  defaultProfile: 'managed-cloud-agent',
  fixedDeploymentProfile: 'managed-cloud-agent',
  defaultBasePath: '/webdev/',
  includeDbVars: false,
  forbidDatabaseBindings: true,
  compatibilityDate: '2026-05-26',
  appName: 'WebDev',
  appDisplayName: 'WebDev',
  appIcon: 'i-lucide-terminal',
  extraVars: () => ({
    HZY_WEBDEV_DEV_AGENT_URL: value('HZY_WEBDEV_DEV_AGENT_URL'),
    HZY_WEBDEV_DATA_RUNTIME_URL: value('HZY_WEBDEV_DATA_RUNTIME_URL', value('HZY_DATA_RUNTIME_URL')),
    HZY_WEBDEV_ALLOWED_UIDS: value('HZY_WEBDEV_ALLOWED_UIDS'),
    HZY_WEBDEV_REQUIRE_APP_GRANT: value('HZY_WEBDEV_REQUIRE_APP_GRANT', 'true'),
    HZY_DATA_RUNTIME_AUDIENCE: value('HZY_DATA_RUNTIME_AUDIENCE', 'data-runtime')
  })
})
