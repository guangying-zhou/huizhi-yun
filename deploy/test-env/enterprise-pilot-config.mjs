import { enterprisePilot as p } from './enterprise-topology.mjs'
import { resolve } from 'node:path'
import { root } from './worker-config.mjs'
import { fileURLToPath } from 'node:url'
export function enterprisePilotConfig() {
  return {
    host: {
      name: p.workerName, main: resolve(root, 'enterprise/.output/server/index.mjs'),
      compatibility_date: '2026-06-15', compatibility_flags: ['nodejs_compat'], workers_dev: false,
      assets: { directory: resolve(root, 'enterprise/.output/public'), binding: 'ASSETS' },
      services: [{ binding: 'HZY_CONSOLE_SERVICE', service: p.consoleWorker },
        { binding: 'HZY_AIMS_SERVICE', service: 'hzy-test-aims' },
        { binding: 'HZY_CODOCS_SERVICE', service: 'hzy-test-codocs' }],
      vars: {
        HZY_ENTERPRISE_PILOT: 'true', HZY_APP_CODE: 'enterprise', NUXT_PUBLIC_APP_CODE: 'enterprise',
        HZY_APP_BASE_PATH: '/', NUXT_PUBLIC_APP_BASE_PATH: '/', NUXT_APP_BASE_URL: '/',
        HZY_AUTH_MODE: 'console-oidc', HZY_CONSOLE_URL: p.origin, HZY_CONSOLE_API_URL: p.origin,
        HZY_PLATFORM_TENANT_CODE: p.tenantCode, HZY_PLATFORM_DEPLOYMENT_CODE: p.deploymentCode,
        HZY_PLATFORM_ENVIRONMENT: 'test', HZY_PLATFORM_URL: 'https://hzy.wiztek.cn',
        HZY_ENTERPRISE_SERVICE_CLIENT_ID: 'enterprise.runtime', HZY_DATA_ACCESS_MODE: 'tenant-runtime',
        HZY_BACKGROUND_JOBS_ENABLED: 'false', HZY_RUNTIME_ENDPOINT: p.runtimeEndpoint
      }
    },
    // Apply these as a merge, preserving current protected registry login and keys.
    gatewayPatch: { vars: { HZY_ENTERPRISE_PILOT: 'true' }, services: [{ binding: 'HZY_ENTERPRISE_SERVICE', service: p.workerName }] },
    registryPatch: { domain: new URL(p.origin).hostname, expectedTenant: p.tenantCode,
      expectedConsoleDeployment: p.consoleDeployment, apps: { enterprise: { deploymentCode: p.deploymentCode,
        dataRuntime: { endpoint: p.runtimeEndpoint, runtimeCode: p.runtimeDeployment, audience: 'data-runtime' } } } },
    consolePatch: { vars: { HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'runtime' } },
    buildEnvironment: { HZY_ENTERPRISE_PILOT: 'true', HZY_CONSOLE_URL: p.origin, HZY_CLOUDFLARE_BUILD: 'true' },
    secretReferencesRequired: ['existing Gateway internal token', 'new enterprise.runtime credential from standard secure enrollment'],
    applied: false
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(enterprisePilotConfig(), null, 2))
