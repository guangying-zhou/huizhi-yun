import { enterpriseHostEntries, enterpriseHostRoutes } from './enterprise-host-routes.mjs'

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
function matchesRegisteredPath(pathname, pattern) {
  const actual = pathname.split('/').filter(Boolean)
  const expected = pattern.split('/').filter(Boolean)
  if (actual.length !== expected.length) return false
  return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index])
}

function resolveLegacyShellPath(path, search = '') {
  const match = path.match(/^\/shell\/([a-z0-9-]+)\/?$/i)
  if (!match) return null
  const appCode = match[1].toLowerCase()
  if (!Object.hasOwn(enterpriseHostRoutes, appCode)) return null
  const params = new URLSearchParams(search)
  const target = params.get('target') || enterpriseHostEntries[appCode]
  if (!target.startsWith(`/${appCode}/`) && target !== `/${appCode}`) return null
  let parsed
  try { parsed = new URL(target, enterprisePilot.origin) } catch { return null }
  if (parsed.origin !== enterprisePilot.origin || /\/(?:api|oauth|oidc)(?:\/|$)/i.test(parsed.pathname)) return null
  if ([`/${appCode}`, `/${appCode}/`].includes(parsed.pathname)) parsed.pathname = enterpriseHostEntries[appCode]
  if (!enterpriseHostRoutes[appCode].some(pattern => matchesRegisteredPath(parsed.pathname, pattern))) return null
  parsed.searchParams.delete('hzy_embed')
  parsed.searchParams.delete('standalone')
  return { path: `${parsed.pathname}${parsed.search}${parsed.hash}`, kind: 'redirect' }
}

export function resolveEnterprisePilotPath(path, search = '') {
  const shell = resolveLegacyShellPath(path, search)
  if (shell) return shell
  if (path === '/enterprise' || path === '/enterprise/') return { path: '/aims/', kind: 'redirect' }
  if (path === '/enterprise/login') return { path, kind: 'page' }
  if (path === '/enterprise/approvals' || /^\/enterprise\/approvals\/[1-9]\d*$/.test(path)) return { path, kind: 'page' }
  if (path === '/enterprise/logo.svg') return { path: '/logo.svg', kind: 'asset' }
  if (path === '/enterprise/api/navigation') return { path, kind: 'api' }
  if (path.startsWith('/enterprise/api/auth/')) return { path: path.slice('/enterprise'.length), kind: 'auth' }
  if (path.startsWith('/enterprise/_nuxt/')) return { path, kind: 'asset' }
  if (/^\/(aims|assets|codocs)(\/|$)/.test(path)) return { path, kind: path.includes('/api/') ? 'api' : 'page' }
  if (path.startsWith('/enterprise/')) return { path, kind: 'unavailable' }
  return null
}
export function validateEnterprisePilotBinding(tenant, binding) {
  return tenant?.tenantCode === enterprisePilot.tenantCode && tenant?.environment === 'test'
    && tenant?.apps?.enterprise?.deploymentCode === enterprisePilot.deploymentCode
    && typeof binding?.fetch === 'function'
}
