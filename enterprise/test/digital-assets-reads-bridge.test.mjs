import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Digital Assets BFF binds exact digital_assets:view scope before its separate read capability', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = []
  let denied = false
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__digitalAssetsReadSession = session
  globalThis.__digitalAssetsReadPrepared = []
  globalThis.__digitalAssetsReadTransport = async (_event, path, options) => { calls.push({ path, options }); return { handled: true, data: { code: 0, data: { items: [] } } } }
  globalThis.__digitalAssetsReadAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    return { grants: denied ? [] : [{ permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'asset', predicate: 'owner' }] }] }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = `export async function requireConsoleSession(){return globalThis.__digitalAssetsReadSession}`
    if (specifier.endsWith('/enterpriseRuntimeClient') || specifier === '@hzy/foundation/server/utils/enterpriseRuntimeClient') source = `export async function requireEnterpriseUser(){return globalThis.__digitalAssetsReadSession}; export async function prepareEnterpriseRuntime(event,operation){globalThis.__digitalAssetsReadPrepared.push(operation)}; export function enterpriseRuntimePermitExpiresAt(){return Date.now()+10000}; export async function callEnterpriseRuntime(event,path,options){return globalThis.__digitalAssetsReadTransport(event,path,options)}`
    if (specifier.endsWith('/platformBundleAuthorization') || specifier === '@hzy/foundation/server/utils/platformBundleAuthorization') source = `export async function loadScopedAuthorizationFromConsoleRuntime(event,uid,app,required){return globalThis.__digitalAssetsReadAuthorization(event,uid,app,required)}`
    if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    return next(specifier, context)
  } })
  const importModule = async relative => {
    const pathname = resolve(root, relative)
    assert.ok(existsSync(pathname), `missing ${relative}`)
    return import(`${pathToFileURL(pathname).href}?digital-assets-read-test=${Date.now()}`)
  }
  let server
  try {
    const [listRoute, detailRoute] = await Promise.all([
      importModule('enterprise/server/routes/assets/api/v1/digital-assets/index.get.ts'),
      importModule('enterprise/server/routes/assets/api/v1/digital-assets/[id]/index.get.ts')
    ])
    const app = createApp(), router = createRouter()
    router.get('/digital-assets', defineEventHandler(listRoute.default))
    router.get('/digital-assets/:id', defineEventHandler(detailRoute.default))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, done))
    const request = async path => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`)
      return { status: response.status, body: await response.json() }
    }
    denied = true
    const deniedResponse = await request('/digital-assets')
    assert.equal(deniedResponse.status, 403)
    assert.equal(deniedResponse.body.data?.code, 'person_permission_denied')
    assert.equal(calls.length, 0)
    denied = false
    assert.equal((await request('/digital-assets?status=active&page=2&pageSize=20')).status, 200)
    const list = calls.at(-1)
    assert.equal(globalThis.__digitalAssetsReadPrepared.at(-1), 'assets.digital-assets-list')
    assert.equal(list.path, 'assets.digital-assets-list')
    assert.equal(list.options.authorization.actorUid, session.uid)
    assert.equal(list.options.authorization.resource, 'digital_assets')
    assert.equal(list.options.authorization.action, 'view')
    assert.equal(list.options.authorization.scope.current_user_assets_object_access, 'relation')
    assert.equal(list.options.query.status, 'active')
    assert.equal((await request('/digital-assets?current_user=forged')).status, 400)
    assert.equal((await request('/digital-assets/0')).status, 400)
    assert.equal((await request('/digital-assets/42')).status, 200)
    assert.equal(calls.at(-1).path, 'assets.digital-assets-view')
    assert.equal(globalThis.__digitalAssetsReadPrepared.at(-1), 'assets.digital-assets-view')
    assert.ok(checks.every(check => check.uid === session.uid && check.app === 'assets' && check.resourceCode === 'digital_assets' && check.action === 'view'))
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    hooks.deregister(); globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__digitalAssetsReadSession; delete globalThis.__digitalAssetsReadTransport; delete globalThis.__digitalAssetsReadAuthorization; delete globalThis.__digitalAssetsReadPrepared
  }
})
