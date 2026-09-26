import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, createError, toNodeListener } from 'h3'

test('IP product link binds session, two scoped permits and idempotency to the exact operation', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = [], checks = [], prepared = []
  let denied = '', failure = 0, authenticated = true
  const session = { uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__ipLinkSession = () => authenticated ? session : Promise.reject(createError({ statusCode: 401 }))
  globalThis.__ipLinkPrepared = operation => prepared.push(operation)
  globalThis.__ipLinkCall = (_event, path, options, transportOptions) => {
    calls.push({ path, options, transportOptions })
    if (failure) throw createError({ statusCode: failure })
    return { code: 0, data: { id: Number(options.id) } }
  }
  globalThis.__ipLinkAuthorization = (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    return { grants: denied === required.resourceCode ? [] : [{ permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'asset', predicate: 'owner' }] }] }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export async function requireEnterpriseUser(){return globalThis.__ipLinkSession()}; export async function prepareEnterpriseRuntime(event, operation){globalThis.__ipLinkPrepared(operation)}; export function enterpriseRuntimePermitExpiresAt(){return Date.now()+10000}; export async function callEnterpriseRuntime(event,path,options,transportOptions){return globalThis.__ipLinkCall(event,path,options,transportOptions)}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export async function loadScopedAuthorizationFromConsoleRuntime(event,uid,app,required){return globalThis.__ipLinkAuthorization(event,uid,app,required)}`
    if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    return next(specifier, context)
  } })
  let server
  try {
    const route = await import(pathToFileURL(resolve(root, 'enterprise/server/routes/assets/api/v1/ip-assets/[id]/products.post.ts')).href)
    const app = createApp(), router = createRouter()
    router.post('/ip-assets/:id/products', route.default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path = '/ip-assets/4/products', body = { product_asset_id: 2 }, key = 'link-1') => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) })
      return response.status
    }
    authenticated = false
    assert.equal(await request(), 401)
    authenticated = true
    for (const [path, body, key] of [
      ['/ip-assets/4/products?actorUid=forged', { product_asset_id: 2 }, 'link-1'],
      ['/ip-assets/0/products', { product_asset_id: 2 }, 'link-1'],
      ['/ip-assets/4/products', { product_asset_id: 0 }, 'link-1'],
      ['/ip-assets/4/products', { product_asset_id: 2, actorUid: 'forged' }, 'link-1'],
      ['/ip-assets/4/products', { product_asset_id: 2 }, '']
    ]) assert.equal(await request(path, body, key), 400)
    assert.equal(calls.length, 0)
    denied = 'ip_assets'
    assert.equal(await request(), 403)
    denied = 'products'
    assert.equal(await request(), 403)
    assert.equal(calls.length, 0)
    denied = ''
    assert.equal(await request(), 200)
    assert.equal(prepared.at(-1), 'assets.ip-assets-link-product')
    assert.deepEqual(checks.slice(-2).map(({ resourceCode, action }) => [resourceCode, action]), [['ip_assets', 'edit'], ['products', 'view']])
    const call = calls.at(-1)
    assert.equal(call.path, 'assets.ip-assets-link-product')
    assert.equal(call.transportOptions.idempotencyKey, 'link-1')
    assert.equal(call.options.id, '4')
    assert.deepEqual(call.options.input, { product_asset_id: 2 })
    for (const permit of [call.options.authorization, call.options.targetAuthorization]) {
      assert.equal(permit.actorUid, session.uid)
      assert.equal(permit.tenant, session.tenant)
      assert.equal(permit.deployment, session.deployment)
    }
    assert.equal(call.options.authorization.resource, 'ip_assets')
    assert.equal(call.options.targetAuthorization.resource, 'products')
    for (failure of [403, 409, 503]) assert.equal(await request(), failure)
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    }
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    for (const key of ['__ipLinkSession', '__ipLinkPrepared', '__ipLinkCall', '__ipLinkAuthorization']) delete globalThis[key]
  }
})
