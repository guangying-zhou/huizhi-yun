import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Platform stores explicit enabled login providers while retaining mode as the default', () => {
  const settings = source('server/utils/tenantDeploymentSettings.ts')
  const patchRoute = source('server/api/platform/tenant-admin/deployment-settings.patch.ts')
  const getRoute = source('server/api/platform/tenant-admin/deployment-settings.get.ts')
  const page = source('app/pages/dashboard/deployments.vue')

  assert.match(settings, /normalizeConsoleLoginProviders/)
  assert.match(settings, /enabledProviders:\s*normalizeConsoleLoginProviders\(login\.enabledProviders, mode\)/)
  assert.match(patchRoute, /enabledProviders\.includes\('oidc'\)/)
  assert.match(patchRoute, /enabledProviders\.includes\('wecom'\)/)
  assert.match(patchRoute, /enabledProviders\.includes\('dingtalk'\)/)
  assert.match(getRoute, /enabledProviders:\s*consoleLogin\.enabledProviders/)

  assert.match(page, /默认登录方式/)
  assert.match(page, /enabledProviders:\s*form\.loginMode === 'none'/)
  assert.match(page, /setLoginProviderEnabled/)
  assert.match(page, /provider\.code === form\.loginMode/)
})

test('legacy login settings enable only their existing primary mode', () => {
  const settings = source('server/utils/tenantDeploymentSettings.ts')
  assert.match(settings, /const providers = configured\.length \? configured : \[mode\]/)
  assert.match(settings, /new Set\(\[mode, \.\.\.providers\]\)/)
})

test('OIDC display name is bounded, defaults safely, and is projected into Console policy', () => {
  const settings = source('server/utils/tenantDeploymentSettings.ts')
  const patchRoute = source('server/api/platform/tenant-admin/deployment-settings.patch.ts')
  const getRoute = source('server/api/platform/tenant-admin/deployment-settings.get.ts')
  const policyBundle = source('server/utils/policyBundle.ts')
  const page = source('app/pages/dashboard/deployments.vue')

  assert.match(settings, /DEFAULT_OIDC_DISPLAY_NAME = '企业统一身份登录'/)
  assert.match(settings, /MAX_OIDC_DISPLAY_NAME_LENGTH = 10/)
  assert.match(settings, /displayName:\s*normalizeOidcDisplayName\(oidc\.displayName\)/)
  assert.match(patchRoute, /Array\.from\(nextOidcDisplayName\)\.length > MAX_OIDC_DISPLAY_NAME_LENGTH/)
  assert.match(patchRoute, /displayName:\s*nextOidcDisplayName/)
  assert.match(getRoute, /displayName:\s*consoleLogin\.oidc\.displayName/)
  assert.match(policyBundle, /const consoleLogin = consoleLoginSettings\(tenantSettings, environment\)/)
  assert.match(policyBundle, /\n\s+consoleLogin,\n/)

  assert.match(page, /v-model="form\.oidcDisplayName"/)
  assert.match(page, /:maxlength="MAX_OIDC_DISPLAY_NAME_LENGTH"/)
  assert.match(page, /displayName:\s*oidcDisplayName/)
  assert.match(page, /最多 10 个汉字/)
})
