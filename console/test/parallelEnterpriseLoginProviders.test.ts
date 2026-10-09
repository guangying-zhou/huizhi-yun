import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Console preserves a primary login mode while enabling explicit secondary providers', () => {
  const config = source('server/utils/loginConfig.ts')
  const page = source('app/pages/login.vue')

  assert.match(config, /enabledProviders:\s*ConsoleLoginProvider\[\]/)
  assert.match(config, /x-hzy-console-login-providers/)
  assert.match(config, /enabledProviders\.includes\('oidc'\)/)
  assert.match(config, /enabledProviders\.includes\('wecom'\)/)
  assert.match(config, /enabledProviders\.includes\('dingtalk'\)/)
  assert.match(config, /enabledProviders\.includes\('cas'\)/)

  assert.match(page, /availableProviders\.value\.length > 1/)
  assert.match(page, /startProviderLogin\('wecom'\)/)
  assert.match(page, /loginConfig\.value\.mode === provider/)
  assert.match(page, /企业统一身份登录/)
  assert.match(config, /oidcDisplayName:\s*config\.oidc\.displayName/)
  assert.match(config, /x-hzy-sso-oidc-display-name/)
  assert.match(config, /displayName:\s*normalizeOidcDisplayName\(oidc\.displayName\)/)
  assert.match(page, /oidcDisplayName:\s*normalizeOidcDisplayName\(dynamicLoginConfig\.data\.oidcDisplayName\)/)
  assert.match(page, /provider === 'oidc'/)
  assert.match(page, /\{\{ providerLabel\(provider\) \}\}/)
  assert.match(page, /企业微信登录/)
  assert.match(page, /钉钉登录/)
  assert.match(page, /if \(redirecting\.value\) return '正在跳转登录\.\.\.'/)
  assert.match(page, /:loading="redirectingProvider === provider"/)
})

test('direct provider starts and callbacks fail closed when that provider is disabled', () => {
  const wecomStart = source('server/api/auth/wecom-login.get.ts')
  const wecomCallback = source('server/api/auth/wecom-callback.get.ts')
  const dingtalkStart = source('server/api/auth/dingtalk-login.get.ts')
  const dingtalkCallback = source('server/api/auth/dingtalk-callback.get.ts')
  const casStart = source('server/api/auth/cas-login.get.ts')
  const casCallback = source('server/api/auth/cas-callback.get.ts')

  assert.match(wecomStart, /!loginConfig\.wecom\.enabled/)
  assert.match(wecomCallback, /!loginConfig\.wecom\.enabled/)
  assert.match(dingtalkStart, /!loginConfig\.dingtalk\.enabled/)
  assert.match(dingtalkCallback, /!loginConfig\.dingtalk\.enabled/)
  assert.match(casStart, /!loginConfig\.cas\.enabled/)
  assert.match(casCallback, /!loginConfig\.cas\.enabled/)
})
