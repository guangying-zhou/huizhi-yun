import test from 'node:test'
import assert from 'node:assert/strict'
import { apps, cloudflareConfig, validateCloudflareTestConfig } from './cloudflare-config.mjs'

test('all test applications retain tenant isolation, authentication and disabled background jobs', () => {
  for (const app of apps) {
    const c = validateCloudflareTestConfig(cloudflareConfig(app))
    assert.equal(c.vars.HZY_APP_CODE, app)
    assert.equal(c.vars.HZY_AUTH_MODE, 'console')
    assert.equal(c.vars.HZY_CONSOLE_DEV_POLICY_BYPASS, 'false')
    assert.equal(c.vars.HZY_BACKGROUND_JOBS_ENABLED, 'false')
    assert.equal(c.vars.NUXT_APP_BASE_URL, app === 'console' ? '/' : `/${app}/`)
  }
})
test('every test Worker stays within the CF Free variable limit with its secrets', () => {
  // Console holds 9 secrets; business Workers hold a service client secret and the Gateway token.
  for (const app of apps) {
    const secrets = app === 'console' ? 9 : 2
    const { vars } = cloudflareConfig(app)
    assert.ok(Object.keys(vars).length + secrets <= 64, `${app} has ${Object.keys(vars).length} vars`)
    assert.ok(vars.HZY_CONSOLE_URL)
    assert.equal(vars.HZY_AIMS_URL, undefined)
  }
  for (const app of ['aims', 'assets']) {
    const { vars } = cloudflareConfig(app)
    assert.ok(vars.HZY_AIMS_API_URL && vars.NUXT_PUBLIC_ASSETS_URL)
  }
})
test('Console keeps every variable its runtime reads', () => {
  const { vars } = cloudflareConfig('console')
  assert.equal(vars.HZY_PLATFORM_BUNDLE_CACHE_BACKEND, 'runtime')
  assert.equal(vars.HZY_PLATFORM_BUNDLE_MAX_AGE_MS, '93600000')
  assert.equal(vars.HZY_PLATFORM_POLICY_BUNDLE_FETCH_TIMEOUT_MS, '90000')
  for (const key of ['HZY_CONSOLE_API_URL', 'NUXT_PUBLIC_CONSOLE_URL', 'HZY_WORKFLOW_API_URL', 'NUXT_PUBLIC_WORKFLOW_ENABLED',
    'HZY_CONSOLE_DATA_ACCESS_MODE', 'HZY_CONSOLE_SERVICE_CLIENT_ID', 'NUXT_CONSOLE_USER_APPLICATIONS_TIMEOUT_MS',
    'NUXT_PUBLIC_APP_CODE', 'NUXT_PUBLIC_APP_BASE_PATH', 'HZY_PLATFORM_DEPLOYMENT_CODE', 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND']) {
    assert.ok(vars[key], key)
  }
  // These are stale cross-app aliases from the pre-Free-limit Console Worker.
  // Console reaches business apps through the Gateway and has no reader for
  // them; retaining them would make Console + its nine secrets exceed 64.
  for (const key of ['HZY_AIMS_API_URL', 'HZY_AIMS_TARGET_DEPLOYMENT', 'HZY_AIMS_URL',
    'HZY_ALTOC_API_URL', 'HZY_ALTOC_TARGET_DEPLOYMENT', 'HZY_ALTOC_URL',
    'HZY_ASSETS_API_URL', 'HZY_ASSETS_TARGET_DEPLOYMENT', 'HZY_ASSETS_URL',
    'HZY_CODOCS_API_URL', 'HZY_CODOCS_TARGET_DEPLOYMENT', 'HZY_CODOCS_URL',
    'HZY_COLLAB_ENABLED', 'HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_ENABLED', 'HZY_CONSOLE_TARGET_DEPLOYMENT',
    'HZY_FINANCE_API_URL', 'HZY_FINANCE_TARGET_DEPLOYMENT', 'HZY_FINANCE_URL',
    'HZY_PEOPLE_API_URL', 'HZY_PEOPLE_TARGET_DEPLOYMENT', 'HZY_PEOPLE_URL',
    'HZY_PLATFORM_BUNDLE_ALLOW_LEGACY_CACHE', 'HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK',
    'HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP', 'HZY_WORKFLOW_TARGET_DEPLOYMENT', 'HZY_WORKFLOW_URL',
    'NUXT_PUBLIC_ACCOUNT_URL', 'NUXT_PUBLIC_AIMS_URL', 'NUXT_PUBLIC_ALTOC_URL', 'NUXT_PUBLIC_ASSETS_URL',
    'NUXT_PUBLIC_CODOCS_URL', 'NUXT_PUBLIC_FINANCE_URL', 'NUXT_PUBLIC_PEOPLE_URL', 'NUXT_PUBLIC_WORKFLOW_URL']) {
    assert.equal(vars[key], undefined, key)
  }
  assert.equal(Object.keys(vars).length, 50)
})
test('business Workers keep the variables their runtimes read', () => {
  for (const app of ['people', 'finance', 'altoc', 'codocs']) {
    const { vars } = cloudflareConfig(app)
    for (const key of ['HZY_CONSOLE_URL', 'NUXT_PUBLIC_CONSOLE_URL', 'NUXT_PUBLIC_ACCOUNT_URL', 'HZY_WORKFLOW_API_URL',
      'HZY_AIMS_API_URL', `HZY_${app.toUpperCase()}_SERVICE_CLIENT_ID`, `HZY_${app.toUpperCase()}_DATA_ACCESS_MODE`]) {
      assert.ok(vars[key], `${app} ${key}`)
    }
    assert.equal(vars.NUXT_PUBLIC_AIMS_URL, undefined, app)
    assert.equal(vars.HZY_FINANCE_TARGET_DEPLOYMENT, undefined, app)
    assert.equal(Boolean(vars.HZY_CONSOLE_TARGET_DEPLOYMENT), app === 'people', app)
  }
  const aims = cloudflareConfig('aims').vars
  assert.ok(aims.NUXT_PUBLIC_ASSETS_URL && aims.HZY_FINANCE_TARGET_DEPLOYMENT && aims.HZY_ALTOC_TARGET_DEPLOYMENT)
})
test('production bindings, exposed app routes and plaintext secrets are rejected', () => {
  for (const mutate of [
    c => { c.name = 'hzy-aims' },
    c => { c.services[0].service = 'hzy-console-prod' },
    c => { c.vars.HZY_PLATFORM_ENVIRONMENT = 'prod' },
    c => { c.vars.HZY_PLATFORM_URL = 'https://huizhi.yun' },
    c => { c.routes = ['*.huizhi.yun/*'] },
    c => { c.vars.HZY_TENANT_RUNTIME_TOKEN = 'secret' },
  ]) {
    const c = cloudflareConfig('aims'); mutate(c)
    assert.throws(() => validateCloudflareTestConfig(c))
  }
})
