import assert from 'node:assert/strict'
import test from 'node:test'
import { consoleFacadeRoute, createConsoleFacade, allowedPublicFacadeToken } from '../console-facade.mjs'
import { fileURLToPath } from 'node:url'

test('public token endpoint never grants runtime identity or alternate clients', () => {
  assert.equal(allowedPublicFacadeToken(JSON.stringify({ grant_type: 'refresh_token', client_id: 'enterprise', refresh_token: 'fixture' })), true)
  for (const body of [{ grant_type: 'client_credentials', client_id: 'console.runtime', app_code: 'console' },
    { grant_type: 'refresh_token', client_id: 'other' }, { grant_type: 'refresh_token', client_id: 'enterprise', app_code: 'enterprise' }]) {
    assert.equal(allowedPublicFacadeToken(JSON.stringify(body)), false)
  }
})

test('only authentication pages, protocols and resources are public', () => {
  for (const path of ['/console/login', '/console/oauth/authorize', '/console/api/auth/oidc-callback',
    '/console/.well-known/openid-configuration', '/console/_nuxt/entry.js']) assert.equal(consoleFacadeRoute(path, 'GET'), true)
  for (const path of ['/console/api/internal/probe', '/console/api/v1/console/vault', '/console/admin',
    '/console/%61pi/auth/oidc-callback', '/console/api/auth/../internal/probe']) assert.equal(consoleFacadeRoute(path, 'GET'), false)
  assert.equal(consoleFacadeRoute('/console/login', 'POST'), false)
  assert.equal(consoleFacadeRoute('/console/oauth/token', 'POST'), true)
})

test('facade strips spoofed headers and isolates private Enterprise source from public callers', async () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: {
    console: { deploymentCode: 'wiztek-test-console' }, enterprise: { deploymentCode: 'C000001-test-enterprise' }
  }, dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev', runtimeCode: 'c000001-test-tenant-runtime' },
  login: { mode: 'oidc', enabledProviders: ['oidc'], oidc: { issuer: 'https://sso.wiztek.cn/realms/wiztek', clientId: 'hzy_local_console', clientSecret: 'sso-fixture' } } }
  const claims = { iss: 'https://hzy.wiztek.cn', aud: 'data-runtime-bootstrap', tenant: 'C000001',
    deployment: 'wiztek-test-console', runtimeCode: 'c000001-test-tenant-runtime', token_use: 'platform_runtime_bootstrap', exp: Math.floor(Date.now()/1000)+60 }
  const token = `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`
  const freshClaims = { ...claims, exp: Math.floor(Date.now()/1000)+90 }
  const freshToken = `fixture.${Buffer.from(JSON.stringify(freshClaims)).toString('base64url')}.fixture`
  const calls = []
  let bootstrapCalls = 0
  const facade = createConsoleFacade({ localSecret: 'local-fixture', credentials: { HZY_PLATFORM_INTERNAL_TOKEN: 'platform-fixture' },
    registryVars: { HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/resolve' }, tenant,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).includes('runtime-bootstrap-token')) {
        bootstrapCalls++
        return Response.json({ data: { token: bootstrapCalls === 1 ? token : freshToken,
          expiresAt: new Date((bootstrapCalls === 1 ? claims : freshClaims).exp*1000).toISOString() } })
      }
      return Response.json({ ok: true })
    } })
  const headers = await facade.headers(new Request('https://hzy0.isme.dev/console/oauth/authorize', { headers: {
    'x-hzy-app-code': 'enterprise', 'x-hzy-deployment': 'other', 'x-hzy-gateway-token': 'spoof', 'x-hzy-data-runtime-url': 'https://evil.test'
  } }))
  assert.equal(headers.get('x-hzy-app-code'), 'console')
  assert.equal(headers.get('x-hzy-deployment'), 'wiztek-test-console')
  assert.equal(headers.get('x-hzy-gateway-token'), 'local-fixture')
  assert.equal(headers.get('x-hzy-data-runtime-url'), tenant.dataRuntime.endpoint)
  assert.equal(headers.get('x-hzy-local-runtime-dial-url'), null)
  assert.equal(headers.get('x-hzy-data-runtime-token'), token)
  await facade.fetch('https://hzy-test.huizhi.yun/oauth/token', { method: 'POST', body: '{}' })
  const forwarded = calls.at(-1)
  assert.equal(forwarded.url, 'http://127.0.0.1:23100/console/oauth/token')
  assert.equal(forwarded.options.headers.get('x-hzy-app-code'), 'enterprise')
  assert.equal(forwarded.options.headers.get('x-hzy-deployment'), 'C000001-test-enterprise')
  assert.deepEqual(JSON.parse(forwarded.options.headers.get('x-hzy-service-routes')).console,
    { origin: 'https://hzy-test.huizhi.yun', basePath: '/console/', deploymentCode: 'wiztek-test-console' })
  assert.equal(forwarded.options.redirect, 'error')
  const localSources = []
  const workflowFacade = createConsoleFacade({ localSecret: 'local-fixture', credentials: { HZY_PLATFORM_INTERNAL_TOKEN: 'platform-fixture' },
    registryVars: { HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/resolve' },
    tenant, workflowLocal: true, fetchImpl: async (target, options) => {
      if (String(target).includes('runtime-bootstrap-token')) return Response.json({ data: { token: freshToken, expiresAt: new Date(freshClaims.exp * 1000).toISOString() } })
      localSources.push({ app: options.headers.get('x-hzy-app-code'), deployment: options.headers.get('x-hzy-deployment') })
      return Response.json({ ok: true })
    } })
  for (const [client, app, deployment] of [
    ['aims.runtime', 'aims', 'C000001-test-aims'],
    ['workflow.runtime', 'workflow', 'C000001-test-workflow-local']
  ]) {
    await workflowFacade.fetch('https://hzy-test.huizhi.yun/oauth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'client_credentials', client_id: client, app_code: app, source_binding: 'trusted-gateway' }) })
    assert.deepEqual(localSources.at(-1), { app, deployment })
  }
  await workflowFacade.fetch('https://hzy-test.huizhi.yun/oauth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'client_credentials', client_id: 'workflow.runtime', app_code: 'aims', source_binding: 'trusted-gateway' }) })
  assert.deepEqual(localSources.at(-1), { app: 'enterprise', deployment: 'C000001-test-enterprise' })
  await facade.fetch('https://hzy-test.huizhi.yun/api/v1/console/notifications/publish', { method: 'POST', body: '{}' })
  const notificationHeaders = calls.at(-1).options.headers
  assert.equal(notificationHeaders.get('x-hzy-app-code'), 'enterprise')
  assert.equal(notificationHeaders.get('x-hzy-deployment'), 'C000001-test-enterprise')
  await facade.fetch('https://hzy-test.huizhi.yun/api/v1/console/notifications/publish', { method: 'GET' })
  assert.equal(calls.at(-1).options.headers.get('x-hzy-app-code'), 'console')
  assert.equal(calls.at(-1).options.headers.get('x-hzy-deployment'), 'wiztek-test-console')
  const syncHeaders = await facade.headers(new Request('https://hzy0.isme.dev/console/api/internal/policy-bundle/sync'))
  assert.equal(syncHeaders.get('x-hzy-data-runtime-token'), freshToken)
  assert.equal(bootstrapCalls, 2, 'sync must not reuse a 60-second cached bootstrap')
  await assert.rejects(facade.fetch('https://evil.test/oauth/token'))
  assert.throws(() => createConsoleFacade({ localSecret: 'x', tenant: { ...tenant, tenantCode: 'other' } }))
  const loopback = createConsoleFacade({ localSecret: 'local-fixture', credentials: { HZY_PLATFORM_INTERNAL_TOKEN: 'platform-fixture' },
    registryVars: { HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/resolve' },
    tenant, runtimeDialEndpoint: 'http://127.0.0.1:18084', fetchImpl: async () => Response.json({ data: {
      token: freshToken, expiresAt: new Date(freshClaims.exp * 1000).toISOString()
    } }) })
  const loopbackHeaders = await loopback.headers(new Request('https://hzy0.isme.dev/console/oauth/authorize'))
  assert.equal(loopbackHeaders.get('x-hzy-data-runtime-url'), tenant.dataRuntime.endpoint)
  assert.equal(loopbackHeaders.get('x-hzy-local-runtime-dial-url'), 'http://127.0.0.1:18084')
  assert.throws(() => createConsoleFacade({ localSecret: 'local-fixture', tenant, runtimeDialEndpoint: 'http://localhost:18084' }))
})

test('console facade admits only encoded dev virtual modules inside this console/.nuxt', () => {
  const dir = fileURLToPath(new URL('../../../../console/.nuxt/', import.meta.url))
  const encode = id => '/console/_nuxt/@id/virtual:nuxt:' + encodeURIComponent(id)
  for (const id of [`${dir}fetch.mjs`, `${dir}components.plugin.mjs`, `${dir}dist/client/x.js`]) {
    assert.equal(consoleFacadeRoute(encode(id), 'GET'), true, id)
  }
  assert.equal(consoleFacadeRoute(encode(`${dir}fetch.mjs`), 'POST'), false)
  for (const id of [`${dir}../server/secret.ts`, `${dir}./fetch.mjs`, `${dir}a%2Fb.mjs`, `${dir}a\\b.mjs`,
    fileURLToPath(new URL('../../../../enterprise/.nuxt/fetch.mjs', import.meta.url)), '/etc/passwd']) {
    assert.equal(consoleFacadeRoute(encode(id), 'GET'), false, id)
  }
  // Other encoded Console paths remain rejected.
  assert.equal(consoleFacadeRoute('/console/_nuxt/%2e%2e/secret', 'GET'), false)
  assert.equal(consoleFacadeRoute('/console/_nuxt/@fs%2Fetc%2Fpasswd', 'GET'), false)
})
