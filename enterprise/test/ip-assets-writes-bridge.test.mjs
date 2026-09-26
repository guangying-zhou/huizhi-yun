import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, createError, defineEventHandler, toNodeListener } from 'h3'

test('IP Assets write BFF binds session and exact edit permission before dispatch', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = []
  let denied = false, failure = 0
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__ipAssetsReadSession = session
  globalThis.__ipAssetsReadPrepared = []
  globalThis.__ipAssetsReadTransport = async (_event, path, options, transportOptions) => { calls.push({ path, options, transportOptions }); if (failure) throw createError({ statusCode: failure, message: "runtime unavailable" }); return { handled: true, data: { code: 0, data: { items: [] } } } }
  globalThis.__ipAssetsReadAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    return { grants: denied ? [] : [{ permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'asset', predicate: 'owner' }] }] }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = `export async function requireConsoleSession(){return globalThis.__ipAssetsReadSession}`
    if (specifier.endsWith('/enterpriseRuntimeClient') || specifier === '@hzy/foundation/server/utils/enterpriseRuntimeClient') source = `export async function requireEnterpriseUser(){return globalThis.__ipAssetsReadSession}; export async function prepareEnterpriseRuntime(event,operation){globalThis.__ipAssetsReadPrepared.push(operation)}; export function enterpriseRuntimePermitExpiresAt(){return Date.now()+10000}; export async function callEnterpriseRuntime(event,path,options,transportOptions){return globalThis.__ipAssetsReadTransport(event,path,options,transportOptions)}`
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
    const [createRoute, editRoute] = await Promise.all([
      importModule('enterprise/server/routes/assets/api/v1/ip-assets/index.post.ts'),
      importModule('enterprise/server/routes/assets/api/v1/ip-assets/[id]/index.patch.ts')
    ])
    const app = createApp(), router = createRouter()
    router.post('/ip-assets', defineEventHandler(createRoute.default))
    router.patch('/ip-assets/:id', defineEventHandler(editRoute.default))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, body = {}, key = 'test-key') => {
      const response = await fetch(base + path, { method: path.split('?')[0] === '/ip-assets' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }
    denied = true
    assert.equal((await request('/ip-assets', { ip_name: 'IP' })).status, 403)
    assert.equal(calls.length, 0)
    denied = false
    assert.equal((await request('/ip-assets?actorUid=forged')).status, 400)
    assert.equal(calls.length, 0)
    for (const [body, key] of [[true, 'key'], [{ actorUid: 'forged' }, 'key'], [{}, ''], [{}, 'x'.repeat(241)]]) {
      assert.equal((await request('/ip-assets', body, key)).status, 400)
      assert.equal(calls.length, 0)
    }
    assert.equal((await request('/ip-assets', { ip_name: 'IP' })).status, 200)
    assert.equal(calls.at(-1).path, 'assets.ip-assets-create')
    assert.equal(calls.at(-1).transportOptions.idempotencyKey, 'test-key')
    const permit = calls.at(-1).options.authorization
    assert.equal(permit.actorUid, session.uid)
    assert.equal(permit.tenant, session.tenant)
    assert.equal(permit.deployment, session.deployment)
    assert.equal(permit.resource, 'ip_assets')
    assert.equal(permit.action, 'edit')
    assert.equal(permit.scope.current_user_assets_object_access, 'relation')
    assert.equal((await request('/ip-assets/42', { notes: null })).status, 200)
    assert.equal(calls.at(-1).path, 'assets.ip-assets-edit')
    assert.equal(calls.at(-1).options.id, '42')
    assert.equal(calls.at(-1).options.input.notes, null)
    assert.equal((await request('/ip-assets/0')).status, 400)
    assert.ok(checks.every(check => check.uid === session.uid && check.app === 'assets' && check.resourceCode === 'ip_assets' && check.action === 'edit'))
    for (failure of [401, 403, 409, 503]) assert.equal((await request('/ip-assets', {})).status, failure)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    hooks.deregister(); globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__ipAssetsReadSession; delete globalThis.__ipAssetsReadTransport; delete globalThis.__ipAssetsReadAuthorization; delete globalThis.__ipAssetsReadPrepared
  }
})
