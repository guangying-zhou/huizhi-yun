import test from 'node:test'
import assert from 'node:assert/strict'
import { appConfig, validateLocalConfig, workerNames } from '../worker-config.mjs'

test('local profiles retain Cloudflare compatibility and actual Console Binding', () => {
  for (const app of ['console', 'people']) {
    const config = validateLocalConfig(appConfig(app))
    assert.deepEqual(config.compatibility_flags, ['nodejs_compat'])
    assert.equal(config.vars.HZY_PLATFORM_ENVIRONMENT, 'test')
    assert.equal(config.vars.HZY_PLATFORM_URL, 'https://hzy.wiztek.cn')
    assert.equal(config.vars.HZY_CONSOLE_DEV_POLICY_BYPASS, 'false')
    assert.equal(config.vars.NUXT_PUBLIC_WORKFLOW_ENABLED, 'false')
    assert.equal(config.vars.NUXT_CONSOLE_USER_APPLICATIONS_TIMEOUT_MS, '15000')
  }
  assert.equal(appConfig('people').services[0].service, workerNames.console)
  assert.throws(() => appConfig('platform'))
})
test('reject production resources, destinations, secrets and missing bindings', () => {
  for (const mutate of [
    c => { c.name = 'hzy-console-prod' }, c => { c.routes = [] },
    c => { c.services = [] }, c => { c.services[0].remote = true },
    c => { c.services[0].service = 'hzy-console-prod' },
    c => { c.vars.HZY_CONSOLE_URL = 'https://console.huizhi.yun' },
    c => { c.vars.HZY_CONSOLE_URL = 'https://altoc.isme.dev' },
    c => { c.vars.HZY_CONSOLE_URL = 'https://hzy0.isme.dev.evil.test' },
    c => { c.vars.SSO_OIDC_CLIENT_SECRET = 'secret' }
  ]) {
    const config = appConfig('people'); mutate(config)
    assert.throws(() => validateLocalConfig(config))
  }
})

test('policy persistence uses Tenant Runtime without any R2 binding', () => {
  const config = appConfig('console')
  assert.equal(config.vars.HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS, '300000')
  assert.equal(config.vars.HZY_PLATFORM_BUNDLE_CACHE_BACKEND, 'runtime')
  assert.equal(config.r2_buckets, undefined)
  for (const override of [{ remote: true }, { bucket_name: 'production-policy' }, { binding: 'OTHER' }]) {
    assert.throws(() => validateLocalConfig({ ...config, r2_buckets: [override] }), /not R2/)
  }
})
