import assert from 'node:assert/strict'
import test from 'node:test'
import { validateEnv, validateHealth, tunnelArgs } from '../local.mjs'
const env = {
  HOST: '127.0.0.1', HZY_DEPLOYMENT_PROFILE: 'dev', HZY_PLATFORM_RUNTIME_ENABLED: 'false',
  HZY_CONSOLE_DATA_ACCESS_MODE: 'tenant-runtime', HZY_CONSOLE_TENANT_RUNTIME_URL: 'http://127.0.0.1:18080',
  HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'false', HZY_PLATFORM_HEARTBEAT_ENABLED: 'false',
  HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false', HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'false',
  HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false', CONSOLE_COLLAB_MODE: 'disabled'
}
test('health requires C000001 test deployment, not just the production-shared tenant code', () => {
  const health = { tenant: 'C000001', deployment: 'c000001-test-tenant-runtime', status: 'ok',
    apps: { console: { db: 'ok' }, directory: { db: 'ok' }, people: { db: 'ok' } } }
  assert.doesNotThrow(() => validateHealth(health))
  assert.throws(() => validateHealth({ ...health, tenant: 'HTEST001' }))
  assert.throws(() => validateHealth({ ...health, deployment: 'C000001-console' }))
  assert.throws(() => validateHealth({ ...health, status: 'error' }))
})
test('isolated local Console configuration is accepted', () => assert.doesNotThrow(() => validateEnv('console', env)))
test('production Runtime cannot replace the test SSH tunnel', () => {
  assert.throws(() => validateEnv('console', { ...env, HZY_CONSOLE_TENANT_RUNTIME_URL: 'https://wiztek-data-runtime.huizhi.yun' }))
})
test('startup side effects and gateway-header trust remain disabled', () => {
  for (const key of ['HZY_PLATFORM_RUNTIME_ENABLED', 'HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'HZY_CONSOLE_TRUST_TENANT_GATEWAY']) {
    assert.throws(() => validateEnv('console', { ...env, [key]: 'true' }))
  }
})
test('DB, Vault and signing private material stay on the Runtime host', () => {
  for (const key of ['DB_PASSWORD', 'HZY_CONSOLE_DB_USER', 'HZY_CONSOLE_VAULT_MASTER_KEY', 'CONSOLE_AUTH_SIGNING_PRIVATE_JWK']) {
    assert.throws(() => validateEnv('console', { ...env, [key]: 'fixture-only' }))
  }
})
test('SSH forwards only loopback Runtime, never MySQL or a public listener', () => {
  assert.deepEqual(tunnelArgs.slice(-3), ['-L', '127.0.0.1:18080:127.0.0.1:18084', 'root@gitlab.wiztek.cn'])
  assert.ok(tunnelArgs.includes('ExitOnForwardFailure=yes'))
  assert.ok(!tunnelArgs.includes('-g'))
})
