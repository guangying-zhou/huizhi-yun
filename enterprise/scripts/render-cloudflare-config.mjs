import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Local dry-run template only: no public route, cron or inferred service grants.
const config = {
  name: process.env.HZY_ENTERPRISE_WORKER_NAME || 'hzy-enterprise-preview',
  main: './.output/server/index.mjs', compatibility_date: '2026-06-15',
  compatibility_flags: ['nodejs_compat'], workers_dev: false,
  assets: { directory: './.output/public', binding: 'ASSETS' },
  services: process.env.HZY_CONSOLE_WORKER_NAME ? [{ binding: 'HZY_CONSOLE_SERVICE', service: process.env.HZY_CONSOLE_WORKER_NAME }] : [],
  vars: {
    HZY_APP_CODE: 'enterprise', NUXT_PUBLIC_APP_CODE: 'enterprise', NUXT_APP_BASE_URL: '/', HZY_AUTH_MODE: 'console-oidc',
    ...(process.env.HZY_CODOCS_ORIGIN ? { NUXT_PUBLIC_CODOCS_URL: process.env.HZY_CODOCS_ORIGIN } : {})
  }
}
writeFileSync(fileURLToPath(new URL('../.wrangler.generated.jsonc', import.meta.url)), JSON.stringify(config, null, 2) + '\n')
