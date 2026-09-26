import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('real migration handler validates Gateway credentials and Console binding before disclosing a Host target', async () => {
  const prior = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ hzy: { tenantGateway: { internalToken: 'isolated-fixture' } } })
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (['../utils/tenantGatewayTrust', '../../app/utils/applicationShellMigration', '../../shared/utils/unsignedDecimal'].includes(specifier)) {
      return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const handler = (await import('../../foundation/server/api/application-shell-migration.get.ts')).default
    const app = createApp()
    app.use(createRouter().get('/api/application-shell-migration', handler))
    server = createServer(toNodeListener(app))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const metadata = { version: 1, appCode: 'enterprise', consoleDeploymentCode: 'console-test', deploymentCode: 'enterprise-test', pages: { aims: ['/aims/projects', '/aims/projects/new', '/aims/projects/:id'] }, entries: { aims: '/aims/projects' } }
    const headers = {
      'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'isolated-fixture',
      'x-hzy-tenant': 'tenant-test', 'x-hzy-deployment': 'console-test', 'x-hzy-environment': 'test', 'x-hzy-app-code': 'console',
      'x-forwarded-host': 'tenant.example', 'x-forwarded-proto': 'https', 'x-hzy-enterprise-shell-pages': JSON.stringify(metadata)
    }
    async function request(target, overrides = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/application-shell-migration?${new URLSearchParams({ appCode: 'aims', target })}`, { headers: { ...headers, ...overrides } })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      return response.json()
    }
    assert.deepEqual(await request('https://tenant.example/aims/?search=Alpha#row'), { migrated: true, target: '/aims/projects?search=Alpha#row', release: 'enterprise-test' })
    assert.equal((await request('/aims/projects/new')).migrated, true)
    for (const target of ['/aims/not-migrated', '/aims/api/projects', '//attacker.example/aims/projects', '/aims/projects/%2fapi']) {
      assert.deepEqual(await request(target), { migrated: false })
    }
    for (const override of [
      { 'x-hzy-gateway-token': 'forged' }, { 'x-hzy-gateway-token': '' }, { 'x-hzy-gateway': '' },
      { 'x-hzy-app-code': 'aims' }, { 'x-hzy-deployment': 'wrong-console' },
      { 'x-hzy-enterprise-shell-pages': '' }, { 'x-hzy-enterprise-shell-pages': 'null' }
    ]) assert.deepEqual(await request('/aims/projects', override), { migrated: false })
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    hooks.deregister()
    if (prior === undefined) delete globalThis.useRuntimeConfig
    else globalThis.useRuntimeConfig = prior
  }
})
