import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')

test('tenant gateway never projects enterprise provider secrets', () => {
  const inject = source.slice(source.indexOf('function injectConsoleLoginHeaders'), source.indexOf('function setHeaderIfValue'))
  const normalize = source.slice(source.indexOf('function normalizeLogin'), source.indexOf('function shouldInjectDataRuntime'))
  assert.doesNotMatch(inject, /corpsecret|appSecret/)
  assert.doesNotMatch(normalize, /corpsecret|appSecret/)
  assert.match(inject, /x-hzy-dingtalk-client-id/)
  assert.match(inject, /x-hzy-console-login-providers/)
  assert.match(inject, /x-hzy-sso-oidc-display-name/)
  assert.match(inject, /config\.enabledProviders\.includes\('oidc'\)/)
  assert.match(inject, /config\.enabledProviders\.includes\('wecom'\)/)
  assert.match(inject, /config\.enabledProviders\.includes\('dingtalk'\)/)
  assert.match(normalize, /'dingtalk'/)
  assert.match(normalize, /enabledProviders/)
})
