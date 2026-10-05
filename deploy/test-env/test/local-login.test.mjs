import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveLocalLogin, validateLocalLogin } from '../local-login.mjs'

const legacy = { issuer: 'https://sso.wiztek.cn/realms/hzy-test', clientId: 'hzy-test-console', clientSecret: 'old-fixture' }
const shared = { issuer: 'https://sso.wiztek.cn/realms/wiztek', clientId: 'hzy_local_console', clientSecret: 'new-fixture' }
const env = { SSO_OIDC_ENABLE: 'true', SSO_OIDC_ISSUER: shared.issuer, SSO_OIDC_CLIENT_ID: shared.clientId }

test('explicit local SSO configuration wins without mixing remote credentials', () => {
  assert.deepEqual(resolveLocalLogin({ ...env, SSO_OIDC_CLIENT_SECRET: shared.clientSecret }, legacy), shared)
  assert.deepEqual(resolveLocalLogin(env, shared), shared)
  assert.throws(() => resolveLocalLogin(env, legacy), /does not match/)
  assert.throws(() => resolveLocalLogin(env), /does not match/)
})
test('legacy test SSO remains supported only when no local selection exists', () => {
  assert.deepEqual(resolveLocalLogin({}, legacy), legacy)
  assert.deepEqual(validateLocalLogin({ ...legacy, password: 'never-forward' }), legacy)
})
test('partial, disabled, unapproved and production-client configurations fail closed', () => {
  assert.throws(() => resolveLocalLogin({ SSO_OIDC_ISSUER: shared.issuer }, legacy))
  assert.throws(() => resolveLocalLogin({ ...env, SSO_OIDC_ENABLE: 'false' }, shared))
  for (const input of [{ ...shared, clientSecret: '' }, { ...shared, clientId: legacy.clientId },
    { ...shared, clientId: 'production-console' }, { ...shared, issuer: 'http://sso.wiztek.cn/realms/wiztek' },
    { ...shared, issuer: 'https://evil.example/realms/wiztek' }]) {
    assert.throws(() => validateLocalLogin(input), error => !error.message.includes('new-fixture'))
  }
})
