import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Platform projects only non-secret DingTalk login metadata', () => {
  const settings = source('server/utils/tenantDeploymentSettings.ts')
  const patchRoute = source('server/api/platform/tenant-admin/deployment-settings.patch.ts')
  const getRoute = source('server/api/platform/tenant-admin/deployment-settings.get.ts')
  const page = source('app/pages/dashboard/deployments.vue')
  const redaction = source('server/utils/policyBundle.ts')

  const start = settings.indexOf('dingtalk: {', settings.indexOf('export function consoleLoginSettings'))
  const dingtalkSettings = settings.slice(start, settings.indexOf('\n    }', start) + 6)
  assert.match(dingtalkSettings, /clientId/)
  assert.match(dingtalkSettings, /corpId/)
  assert.doesNotMatch(dingtalkSettings, /appSecret/)
  assert.doesNotMatch(getRoute, /appSecretConfigured/)
  assert.match(patchRoute, /appSecret belongs in Console Vault/)
  assert.match(page, /AppSecret 请在企业控制台集成中心配置到 dingtalk\.default/)
  assert.match(redaction, /\['dingtalk', 'appSecret'\]/)
})
