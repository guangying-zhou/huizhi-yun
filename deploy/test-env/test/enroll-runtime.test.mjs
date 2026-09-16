import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { assertTestConfig, enrolledConfig, enrollmentTarget as t } from '../enroll-runtime.mjs'

const fixture = () => ({
  tenant: t.tenant, deployment: t.runtime,
  deploymentBindings: { console: 'C000001-test-console', people: t.bindings.people },
  server: { host: '127.0.0.1', port: 18084 },
  auth: { mode: 'jwt', jwt: { jwksJson: '{"keys":[]}', issuer: 'http://127.0.0.1:3000/console' } },
  apps: Object.fromEntries(['console', 'directory', 'people'].map(app => [app, {
    enabled: true, db: { host: '127.0.0.1', port: 13316, user: 'hzy_test_runtime', password: 'fixture',
      database: app === 'people' ? 'hzy_people_test_20260905' : 'hzy_console_test_20260905' }
  }]))
})
const trust = { kid: 'test-key', alg: 'Ed25519', publicKey: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) }
const envFixture = () => ({
  HZY_DATA_RUNTIME_PLATFORM_URL: t.platform, HZY_DATA_RUNTIME_INSTANCE: t.runtime,
  HZY_DATA_RUNTIME_DEPLOYMENT: t.runtime, HZY_DATA_RUNTIME_PUBLIC_ENDPOINT: t.endpoint,
  HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID: t.keyId, HZY_DATA_RUNTIME_CONTROL_TOKEN: 'hzy_ctl_fixture',
  HZY_DATA_RUNTIME_STATIC_TOKEN: 'must-not-be-installed',
  HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64: Buffer.from(JSON.stringify(t.bindings)).toString('base64')
})
test('enrollment changes only control and exact test app bindings; never installs compatibility token', () => {
  const c = fixture(), after = enrolledConfig(c, envFixture(), trust)
  assert.deepEqual(after.apps, c.apps)
  assert.deepEqual(after.auth, c.auth)
  assert.equal(after.auth.staticToken, undefined)
  assert.deepEqual(after.deploymentBindings, t.bindings)
  assert.equal(after.control.platformUrl, t.platform)
  assert.equal(c.control, undefined)
})
test('non-test source configurations fail closed', () => {
  for (const alter of [
    c => { c.tenant = 'C000002' }, c => { c.deployment = 'C000001-console' },
    c => { c.apps.people.db.database = 'hzy_people' }, c => { c.apps.console.db.host = 'oa.wiztek.cn' },
    c => { c.server.host = '0.0.0.0' }, c => { c.auth.mode = 'disabled' },
    c => { c.control = { token: 'existing' } }, c => { c.auth.jwt.issuer = 'https://wiztek.huizhi.yun' }
  ]) { const c = fixture(); alter(c); assert.throws(() => assertTestConfig(c)) }
})
test('wrong control origin, deployment, release key and bindings fail closed', () => {
  for (const [key, value] of Object.entries({
    HZY_DATA_RUNTIME_PLATFORM_URL: 'https://huizhi.yun', HZY_DATA_RUNTIME_INSTANCE: 'production',
    HZY_DATA_RUNTIME_PUBLIC_ENDPOINT: 'https://wiztek-data-runtime.huizhi.yun',
    HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID: 'wrong', HZY_DATA_RUNTIME_CONTROL_TOKEN: 'static',
    HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64: Buffer.from(JSON.stringify({ console: 'C000001-console', people: 'C000001-people' })).toString('base64')
  })) assert.throws(() => enrolledConfig(fixture(), { ...envFixture(), [key]: value }, trust))
  assert.throws(() => enrolledConfig(fixture(), envFixture(), { ...trust, alg: 'RSA' }))
})
