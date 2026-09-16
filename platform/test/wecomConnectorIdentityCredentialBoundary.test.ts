import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Platform keeps only non-secret WeCom login metadata and directs secret management to Console Vault', () => {
  const settings = source('server/utils/tenantDeploymentSettings.ts')
  const patchRoute = source('server/api/platform/tenant-admin/deployment-settings.patch.ts')
  const getRoute = source('server/api/platform/tenant-admin/deployment-settings.get.ts')
  const page = source('app/pages/dashboard/deployments.vue')

  const wecomSettings = settings.slice(settings.indexOf('wecom: {', settings.indexOf('export function consoleLoginSettings')), settings.indexOf('\n    }', settings.indexOf('wecom: {', settings.indexOf('export function consoleLoginSettings'))) + 6)
  assert.match(wecomSettings, /corpid/)
  assert.match(wecomSettings, /agentid/)
  assert.doesNotMatch(wecomSettings, /corpsecret/)
  assert.doesNotMatch(patchRoute, /nextWecomCorpsecret|previousWecom\.corpsecret/)
  assert.match(patchRoute, /corpsecret belongs in Console Vault/)
  assert.doesNotMatch(getRoute, /corpsecretConfigured/)
  assert.match(page, /Corp Secret 由 Console Vault 管理/)
  assert.match(page, /const wecomCallbackDomain = computed/)
  assert.match(page, /const wecomCallbackUrl = computed/)
  assert.match(page, /企业微信授权登录 \/ Web 网页/)
  assert.match(page, /网页授权及 JS-SDK \/ 可信域名/)
  assert.match(page, /\/api\/auth\/wecom-callback/)
  assert.match(page, /copyArtifact\(wecomCallbackDomain, 'wecom-callback-domain'\)/)
  assert.match(page, /copyArtifact\(wecomCallbackUrl, 'wecom-callback-url'\)/)
  assert.doesNotMatch(page, /wecomCorpsecret|corpsecretConfigured/)
})
