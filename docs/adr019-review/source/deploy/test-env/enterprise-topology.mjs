/** Explicit same-origin pilot; no DNS, credentials or deployment are created. */
export const enterprisePilot = Object.freeze({
  origin: 'https://hzy-test.huizhi.yun', tenantCode: 'C000001', environment: 'test',
  appCode: 'enterprise', deploymentCode: 'C000001-test-enterprise', workerName: 'hzy-test-enterprise',
  consoleDeployment: 'wiztek-test-console', consoleWorker: 'hzy-test-console',
  runtimeDeployment: 'c000001-test-tenant-runtime', runtimeEndpoint: 'https://hzy-test-runtime.isme.dev',
  authPrefix: '/enterprise', loginPath: '/enterprise/login',
  callback: 'https://hzy-test.huizhi.yun/enterprise/api/auth/oidc-callback',
  logoutRedirect: 'https://hzy-test.huizhi.yun/enterprise/login',
  buildAssetsDir: '/enterprise/_nuxt/', capabilitiesSource: './enterprise-readiness.template.json'
})
export function resolveEnterprisePilotPath(path) {
  if (path === '/enterprise' || path === '/enterprise/') return { path: '/aims/', kind: 'redirect' }
  if (path === '/enterprise/login') return { path, kind: 'page' }
  if (path.startsWith('/enterprise/api/auth/')) return { path: path.slice('/enterprise'.length), kind: 'auth' }
  if (path.startsWith('/enterprise/_nuxt/')) return { path, kind: 'asset' }
  if (/^\/(aims|assets)(\/|$)/.test(path)) return { path, kind: path.includes('/api/') ? 'api' : 'page' }
  if (path.startsWith('/enterprise/')) return { path, kind: 'unavailable' }
  return null
}
export function validateEnterprisePilotBinding(tenant, binding) {
  return tenant?.tenantCode === enterprisePilot.tenantCode && tenant?.environment === 'test'
    && tenant?.apps?.enterprise?.deploymentCode === enterprisePilot.deploymentCode
    && typeof binding?.fetch === 'function'
}
