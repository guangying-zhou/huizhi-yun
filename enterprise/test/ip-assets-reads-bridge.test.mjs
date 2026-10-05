import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('IP Assets BFF binds exact ip_assets:view scope before its separate read capability', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = []
  let denied = false, deniedResource = ''
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__ipAssetsReadSession = session
  globalThis.__ipAssetsReadPrepared = []
  globalThis.__ipAssetsReadTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: { items: [] } } }
  }
  globalThis.__ipAssetsReadAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    return { grants: denied || deniedResource === required.resourceCode ? [] : [{ permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'asset', predicate: 'owner' }] }] }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = `export async function requireConsoleSession(){return globalThis.__ipAssetsReadSession}`
    if (specifier.endsWith('/enterpriseRuntimeClient') || specifier === '@hzy/foundation/server/utils/enterpriseRuntimeClient') source = `export async function requireEnterpriseUser(){return globalThis.__ipAssetsReadSession}; export async function prepareEnterpriseRuntime(event,operation){globalThis.__ipAssetsReadPrepared.push(operation)}; export function enterpriseRuntimePermitExpiresAt(){return Date.now()+10000}; export async function callEnterpriseRuntime(event,path,options){return globalThis.__ipAssetsReadTransport(event,path,options)}`
    if (specifier.endsWith('/platformBundleAuthorization') || specifier === '@hzy/foundation/server/utils/platformBundleAuthorization') source = `export async function loadScopedAuthorizationFromConsoleRuntime(event,uid,app,required){return globalThis.__ipAssetsReadAuthorization(event,uid,app,required)}`
    if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    return next(specifier, context)
  } })
  const importModule = async relative => import(`${pathToFileURL(resolve(root, relative)).href}?ip-assets-read-test=${Date.now()}`)
  let server
  try {
    const [listRoute, detailRoute, productsRoute] = await Promise.all([
      importModule('enterprise/server/routes/assets/api/v1/ip-assets/index.get.ts'),
      importModule('enterprise/server/routes/assets/api/v1/ip-assets/[id]/index.get.ts'),
      importModule('enterprise/server/routes/assets/api/v1/ip-assets/[id]/products.get.ts')
    ])
    const app = createApp(), router = createRouter()
    router.get('/ip-assets', defineEventHandler(listRoute.default))
    router.get('/ip-assets/:id', defineEventHandler(detailRoute.default))
    router.get('/ip-assets/:id/products', defineEventHandler(productsRoute.default))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, done))
    const request = async (path) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`)
      return { status: response.status, body: await response.json() }
    }
    denied = true
    const deniedResponse = await request('/ip-assets')
    assert.equal(deniedResponse.status, 403)
    assert.equal(deniedResponse.body.data?.code, 'person_permission_denied')
    assert.equal(calls.length, 0)
    denied = false
    assert.equal((await request('/ip-assets?status=active&page=2&pageSize=20')).status, 200)
    const list = calls.at(-1)
    assert.equal(globalThis.__ipAssetsReadPrepared.at(-1), 'assets.ip-assets-list')
    assert.equal(list.path, 'assets.ip-assets-list')
    assert.equal(list.options.authorization.actorUid, session.uid)
    assert.equal(list.options.authorization.resource, 'ip_assets')
    assert.equal(list.options.authorization.action, 'view')
    assert.equal(list.options.authorization.scope.current_user_assets_object_access, 'relation')
    assert.equal(list.options.query.status, 'active')
    assert.equal((await request('/ip-assets?current_user=forged')).status, 400)
    assert.equal((await request('/ip-assets/0')).status, 400)
    assert.equal((await request('/ip-assets/42')).status, 200)
    assert.equal(calls.at(-1).path, 'assets.ip-assets-view')
    assert.equal(globalThis.__ipAssetsReadPrepared.at(-1), 'assets.ip-assets-view')
    assert.equal((await request('/ip-assets/42/products?actorUid=forged')).status, 400)
    deniedResource = 'products'
    assert.equal((await request('/ip-assets/42/products')).status, 403)
    deniedResource = ''
    assert.equal((await request('/ip-assets/42/products')).status, 200)
    const products = calls.at(-1)
    assert.equal(products.path, 'assets.ip-assets-products')
    assert.equal(products.options.id, '42')
    assert.equal(products.options.targetAuthorization.actorUid, session.uid)
    assert.equal(products.options.targetAuthorization.resource, 'products')
    assert.equal(products.options.targetAuthorization.action, 'view')
    assert.ok(checks.every(check => check.uid === session.uid && check.app === 'assets' && check.action === 'view'))
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    }
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__ipAssetsReadSession
    delete globalThis.__ipAssetsReadTransport
    delete globalThis.__ipAssetsReadAuthorization
    delete globalThis.__ipAssetsReadPrepared
  }
})
