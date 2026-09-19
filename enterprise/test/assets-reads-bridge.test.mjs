import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Assets read BFF binds exact asset_items:view scope before the exact Enterprise read capability', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = []
  let denied = false
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__assetsReadSession = session
  globalThis.__assetsReadTransport = async (_event, path, options) => { calls.push({ path, options }); return { handled: true, data: { code: 0, data: { items: [] } } } }
  globalThis.__assetsReadAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    return { grants: denied ? [] : [{ permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'asset', predicate: 'owner' }] }] }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__assetsReadSession'
    if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__assetsReadTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__assetsReadAuthorization(...args)'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    router.get('/dictionaries', (await import('../server/routes/assets/api/v1/asset-dictionaries.get.ts')).default)
    router.get('/assets', (await import('../server/routes/assets/api/v1/assets/index.get.ts')).default)
    router.get('/assets/:id', (await import('../server/routes/assets/api/v1/assets/[id]/index.get.ts')).default)
    app.use(router); server = createServer(toNodeListener(app)); await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async path => {
      const response = await fetch(base + path, { headers: { 'x-hzy-actor-uid': 'forged' } })
      return { status: response.status, body: await response.json() }
    }

    denied = true
    const deniedResponse = await request('/assets?category=physical')
    assert.equal(deniedResponse.status, 403)
    assert.equal(deniedResponse.body.data?.code, 'person_permission_denied')
    assert.equal(calls.length, 0)
    denied = false
    assert.equal((await request('/assets?category=physical&page=2&pageSize=20')).status, 200)
    const list = calls.at(-1)
    assert.equal(list.options.scope, 'assets:asset-item:read')
    assert.ok(list.path.endsWith('/assets:list'))
    assert.equal(list.options.body.authorization.actorUid, session.uid)
    assert.equal(list.options.body.authorization.resource, 'asset_items')
    assert.equal(list.options.body.authorization.action, 'view')
    assert.equal(list.options.body.authorization.scope.current_user_assets_object_access, 'relation')
    assert.equal(list.options.body.query.category, 'physical')
    assert.equal((await request('/assets?current_user=forged')).status, 400)
    assert.equal((await request('/assets/not%2Fvalid')).status, 400)
    assert.equal((await request('/assets/AST-001')).status, 200)
    assert.ok(calls.at(-1).path.endsWith('/assets:view'))
    assert.equal((await request('/dictionaries')).status, 200)
    assert.ok(calls.at(-1).path.endsWith('/dictionaries:list'))
    assert.ok(checks.every(check => check.uid === session.uid && check.app === 'assets' && check.resourceCode === 'asset_items' && check.action === 'view'))
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    hooks.deregister(); globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__assetsReadSession; delete globalThis.__assetsReadTransport; delete globalThis.__assetsReadAuthorization
  }
})
