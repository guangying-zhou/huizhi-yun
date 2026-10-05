import test from 'node:test'
import assert from 'node:assert/strict'
import { rebindConfig, targetBinding } from '../rebind-runtime.mjs'

const fixture = () => ({
  tenant: 'HTEST001', deployment: 'htest001-test-tenant-runtime',
  deploymentBindings: { console: 'HTEST001-console', people: 'HTEST001-people' },
  server: { host: '127.0.0.1', port: 18084 },
  auth: { mode: 'jwt', jwt: { jwksJson: '{"keys":[]}', issuer: 'test-only' } },
  apps: Object.fromEntries(['console', 'directory', 'people'].map(app => [app, {
    enabled: true, db: { host: '127.0.0.1', port: 13316, user: 'hzy_test_runtime',
      database: app === 'people' ? 'hzy_people_test_20260905' : 'hzy_console_test_20260905', password: 'fixture' }
  }]))
})
test('rebind changes only tenant and test-qualified deployments', () => {
  const before = fixture(), after = rebindConfig(before)
  assert.deepEqual(after, { ...before, ...targetBinding })
  assert.equal(before.tenant, 'HTEST001')
  assert.deepEqual(after.auth, before.auth)
  assert.deepEqual(after.apps, before.apps)
})
test('production or unrecognized bindings, DB and public listeners fail closed', () => {
  for (const alter of [
    c => { c.tenant = 'C000001' },
    c => { c.deploymentBindings.console = 'C000001-console' },
    c => { c.apps.console.db.host = 'oa.wiztek.cn' },
    c => { c.apps.people.db.database = 'hzy_people' },
    c => { c.server.host = '0.0.0.0' },
    c => { c.auth.mode = 'disabled' },
    c => { c.control = { platformUrl: 'https://huizhi.yun' } }
  ]) { const c = fixture(); alter(c); assert.throws(() => rebindConfig(c)) }
})
