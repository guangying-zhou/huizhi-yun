import { resolve } from 'node:path'
import { appConfig, root } from './worker-config.mjs'

export const stateDir = resolve(root, 'deploy/test-env/.cloudflare-workers')
export const origin = 'https://hzy-test.huizhi.yun'
export const apps = ['console', 'people', 'aims', 'assets', 'finance', 'altoc', 'codocs']
export function cloudflareConfig(app) {
  if (!apps.includes(app)) throw Error('Unsupported test application')
  const config = appConfig(app === 'console' ? 'console' : 'people')
  const vars = config.vars
  for (const key of Object.keys(vars)) {
    if (app !== 'people' && key.includes('PEOPLE')) delete vars[key]
    else if (typeof vars[key] === 'string') vars[key] = vars[key].replaceAll('https://hzy0.isme.dev', origin)
  }
  const base = app === 'console' ? '/' : `/${app}/`
  Object.assign(vars, {
    HZY_APP_CODE: app, NUXT_PUBLIC_APP_CODE: app,
    HZY_APP_BASE_PATH: base, NUXT_PUBLIC_APP_BASE_PATH: base, NUXT_APP_BASE_URL: base,
    HZY_PLATFORM_DEPLOYMENT_CODE: app === 'console' ? 'wiztek-test-console' : `C000001-test-${app}`,
    [`HZY_${app.toUpperCase()}_DATA_ACCESS_MODE`]: 'tenant-runtime',
    [`HZY_${app.toUpperCase()}_SERVICE_CLIENT_ID`]: `${app}.runtime`,
  })
  if (app === 'console') {
    vars.HZY_PLATFORM_BUNDLE_CACHE_SCOPE = 'cloudflare-C000001-test-console'
    // Match the active production rollback mode until scheduled durable sync
    // has sustained availability; cache misses still fetch and verify policy.
    vars.HZY_PLATFORM_BUNDLE_CACHE_BACKEND = 'memory'
  }
  for (const target of [...apps, 'workflow']) {
    const code = target.toUpperCase()
    const url = target === 'console' ? origin : `${origin}/${target}`
    vars[`HZY_${code}_URL`] = url
    vars[`HZY_${code}_API_URL`] = url
    vars[`NUXT_PUBLIC_${code}_URL`] = url
    vars[`HZY_${code}_TARGET_DEPLOYMENT`] = target === 'console' ? 'wiztek-test-console' : `C000001-test-${target}`
  }
  // CF Free rejects >64 variables per Worker (text + secrets, code 10055), so
  // drop aliases the target Worker never reads.
  // Business apps and Foundation resolve cross-app requests from *_API_URL
  // (kept: Foundation falls back to HZY_<app>_API_URL dynamically); of
  // HZY_<app>_URL only Console's is read.
  if (app !== 'console') {
    for (const target of [...apps, 'workflow']) {
      if (target !== 'console') delete vars['HZY_' + target.toUpperCase() + '_URL']
    }
  }
  // AIMS reads NUXT_PUBLIC_*_URL and some *_TARGET_DEPLOYMENT, and Assets is
  // already within the limit. The rest only map public.accountUrl (kept), and
  // only People reads a target deployment: HZY_CONSOLE_TARGET_DEPLOYMENT.
  if (['people', 'finance', 'altoc', 'codocs'].includes(app)) {
    for (const target of [...apps, 'workflow']) {
      const code = target.toUpperCase()
      if (!(app === 'people' && target === 'console')) delete vars[`HZY_${code}_TARGET_DEPLOYMENT`]
      if (target !== 'console') delete vars[`NUXT_PUBLIC_${code}_URL`]
    }
  }
  // Console reaches other apps only through trusted Gateway routes (directTarget)
  // and reads HZY_WORKFLOW_API_URL; it has no per-app public URL or target
  // deployment config. The flags below have no reader in Console/Foundation/collab.
  if (app === 'console') {
    for (const target of [...apps, 'workflow']) {
      const code = target.toUpperCase()
      delete vars[`HZY_${code}_TARGET_DEPLOYMENT`]
      if (target === 'console') continue
      delete vars[`HZY_${code}_URL`]
      delete vars[`NUXT_PUBLIC_${code}_URL`]
      if (target !== 'workflow') delete vars[`HZY_${code}_API_URL`]
    }
    for (const key of ['NUXT_PUBLIC_ACCOUNT_URL', 'HZY_COLLAB_ENABLED', 'HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP',
      'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_ENABLED', 'HZY_PLATFORM_BUNDLE_ALLOW_LEGACY_CACHE',
      'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK']) delete vars[key]
  }
  return {
    ...config, name: `hzy-test-${app}`, workers_dev: false,
    assets: { directory: app === 'console' ? './output/public' : './assets', binding: 'ASSETS' },
    services: app === 'console' ? [] : ['console', 'aims', 'assets', 'finance'].filter(target => target !== app)
      .map(target => ({ binding: `HZY_${target.toUpperCase()}_SERVICE`, service: `hzy-test-${target}` })),
    vars,
  }
}

export function validateCloudflareTestConfig(config) {
  if (!apps.some(app => config.name === `hzy-test-${app}`)) throw Error('Unexpected test Worker')
  if (config.workers_dev !== false || config.routes || config.triggers) throw Error('App ingress and scheduling must remain disabled')
  if (config.vars.HZY_PLATFORM_TENANT_CODE !== 'C000001' || config.vars.HZY_PLATFORM_ENVIRONMENT !== 'test') throw Error('Unexpected tenant/environment')
  if (config.vars.HZY_PLATFORM_URL !== 'https://hzy.wiztek.cn') throw Error('Unexpected control plane')
  for (const service of config.services || []) {
    if (!apps.some(app => service.service === `hzy-test-${app}`)) throw Error('Non-test service binding')
  }
  for (const [key, value] of Object.entries(config.vars)) {
    if (/(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY)$/.test(key)) throw Error('Secrets belong in Worker secrets')
    if (typeof value === 'string' && /hzy0\.isme\.dev|127\.0\.0\.1|hzy-console-prod/.test(value)) throw Error('Local or production endpoint')
  }
  return config
}
