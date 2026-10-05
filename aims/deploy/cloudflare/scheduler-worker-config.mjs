// Deployment-only configuration for the private Aims drain target. The normal
// standalone Aims renderer remains unchanged. Do not add routes or a cron:
// Tenant Gateway is the sole scheduler and calls this Worker via Binding.
export function schedulerWorkerConfig(environment) {
  if (!['production', 'staging'].includes(environment)) throw new Error('unknown Aims scheduler environment')
  const staging = environment === 'staging'
  const worker = name => staging ? `hzy-test-${name}` : `hzy-${name}`
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: worker('aims'),
    main: '.output/server/index.mjs',
    compatibility_date: '2026-05-24',
    compatibility_flags: ['nodejs_compat'],
    observability: { enabled: true },
    workers_dev: false,
    preview_urls: false,
    services: ['console', 'altoc', 'assets', 'people', 'finance', 'codocs']
      .map(name => ({ binding: `HZY_${name.toUpperCase()}_SERVICE`, service: name === 'console' && !staging ? 'hzy-console-prod' : worker(name) })),
    vars: {
      NODE_ENV: 'production',
      HZY_CLOUDFLARE_BUILD: 'true',
      HZY_DEPLOYMENT_PROFILE: 'managed-cloud-agent',
      NUXT_PUBLIC_DEPLOYMENT_PROFILE: 'managed-cloud-agent',
      HZY_APP_CODE: 'aims', NUXT_PUBLIC_APP_CODE: 'aims',
      HZY_APP_BASE_PATH: '/aims/', NUXT_PUBLIC_APP_BASE_PATH: '/aims/', NUXT_APP_BASE_URL: '/aims/',
      HZY_AIMS_DATA_ACCESS_MODE: 'tenant-runtime', HZY_DATA_ACCESS_MODE: 'tenant-runtime',
      HZY_DATA_RUNTIME_AUDIENCE: 'data-runtime', HZY_TENANT_RUNTIME_AUDIENCE: 'data-runtime',
      HZY_AIMS_SERVICE_CLIENT_ID: 'aims.runtime',
      HZY_AIMS_DUE_NOTIFICATIONS_ENABLED: 'false',
      HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP: 'false',
      HZY_CONSOLE_URL: staging ? 'https://hzy-test.huizhi.yun' : 'https://console.huizhi.yun',
      HZY_CONSOLE_API_URL: staging ? 'https://hzy-test.huizhi.yun' : 'https://console.huizhi.yun'
    }
  }
}
