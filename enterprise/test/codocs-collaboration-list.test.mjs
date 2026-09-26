import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise collaboration list binds actor and separates review-admin capability', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], preparations = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__collabSession', '__collabAuth', '__collabTransport', '__collabPrepare'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__collabSession = session
  globalThis.__collabAuth = { resources: { documents: ['view'], reviews: ['view'] }, actionPolicies: {} }
  globalThis.__collabPrepare = async (_event, options) => { preparations.push(options); return true }
  globalThis.__collabTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { success: true, data: { items: [], total: 0 } } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__collabSession'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__collabPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__collabTransport(...args)'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__collabAuth'
    if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    router.get('/collab-docs', (await import('../server/routes/codocs/api/collab-docs/index.get.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__collabSession }))
    app.use(router)
    server = createServer(toNodeListener(app)); await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    let response = await fetch(`${base}/collab-docs?category=outside&scope=todo&keyword=notice`)
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { code: 0, data: { items: [], total: 0 } })
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/collab-documents:list')
    assert.equal(calls.at(-1).options.scope, 'codocs:collab-documents:read')
    assert.equal(calls.at(-1).options.body.authorization.actorUid, 'person-a')
    assert.equal(calls.at(-1).options.body.authorization.action, 'read')
    assert.deepEqual(calls.at(-1).options.body.query, { category: 'outside', scope: 'todo', keyword: 'notice' })

    globalThis.__collabAuth = { resources: { documents: ['view'], reviews: ['admin'] }, actionPolicies: {} }
    response = await fetch(`${base}/collab-docs?category=outside&scope=todo`)
    assert.equal(response.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/collab-documents:list-admin')
    assert.equal(calls.at(-1).options.scope, 'codocs:collab-documents:review-admin')
    assert.equal(calls.at(-1).options.body.authorization.action, 'review-admin')
    assert.equal(preparations.at(-1).scope, 'codocs:collab-documents:review-admin')

    for (const path of ['/collab-docs?category=project&scope=all', '/collab-docs?category=shared&scope=admin', '/collab-docs?category=shared&scope=all&current_user=victim']) {
      const before = calls.length; assert.equal((await fetch(base + path)).status, 400); assert.equal(calls.length, before)
    }
    globalThis.__collabAuth = { resources: { documents: [] }, actionPolicies: {} }
    const before = calls.length; assert.equal((await fetch(`${base}/collab-docs?category=shared&scope=all`)).status, 403); assert.equal(calls.length, before)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister(); for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
})
