import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, createError, toNodeListener } from 'h3'

test('hosted Assets edit controls use current-user scoped grants and fail closed', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const checks = []
  let grants = new Set(['digital_assets'])
  let fail = false
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export async function requireEnterpriseUser(){if(!globalThis.__assetsWriteAuthenticated)throw globalThis.__assetsWriteUnauthorized;return {uid:'person-a'}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export async function loadScopedAuthorizationFromConsoleRuntime(event,uid,app,required){return globalThis.__assetsWriteAuthorization(uid,app,required)}`
    if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    return next(specifier, context)
  } })
  globalThis.__assetsWriteAuthenticated = true
  globalThis.__assetsWriteUnauthorized = createError({ statusCode: 401 })
  globalThis.__assetsWriteAuthorization = (uid, app, required) => {
    checks.push({ uid, app, ...required })
    if (fail) throw createError({ statusCode: 503 })
    return { grants: grants.has(required.resourceCode)
      ? [{ permissions: [{ appCode: 'assets', resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'asset', predicate: 'owner' }] }]
      : [] }
  }
  let server
  try {
    const route = await import(pathToFileURL(resolve(root, 'enterprise/server/routes/assets/api/v1/write-access.get.ts')).href)
    const app = createApp()
    const router = createRouter()
    router.get('/access', route.default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${server.address().port}/access`
    let response = await fetch(url)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual((await response.json()).data, { digital_assets: true, ip_assets: false, ip_assets_link_product: false })
    assert.deepEqual(checks.map(({ uid, app, resourceCode, action }) => [uid, app, resourceCode, action]), [
      ['person-a', 'assets', 'digital_assets', 'edit'],
      ['person-a', 'assets', 'ip_assets', 'edit'],
      ['person-a', 'assets', 'products', 'view']
    ])
    grants = new Set(['ip_assets'])
    response = await fetch(url)
    assert.deepEqual((await response.json()).data, { digital_assets: false, ip_assets: true, ip_assets_link_product: false })
    grants = new Set(['ip_assets', 'products'])
    response = await fetch(url)
    assert.deepEqual((await response.json()).data, { digital_assets: false, ip_assets: true, ip_assets_link_product: true })
    fail = true
    assert.equal((await fetch(url)).status, 503)
    fail = false
    globalThis.__assetsWriteAuthenticated = false
    assert.equal((await fetch(url)).status, 401)
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    }
    hooks.deregister()
    delete globalThis.__assetsWriteAuthenticated
    delete globalThis.__assetsWriteUnauthorized
    delete globalThis.__assetsWriteAuthorization
  }
})
