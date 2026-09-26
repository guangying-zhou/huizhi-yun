import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Host compiles current Altoc and Aims permissions into bound activation evidence', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = [], directories = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', deptCodes: ['dept-self'] }
  let denyAltoc = false, denyAims = false, globalAdmin = false
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__activationSession = session
  globalThis.__activationAuth = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    if ((app === 'altoc' && denyAltoc) || (app === 'aims' && denyAims)) return { roles: [], grants: [], decision: { allowed: false } }
    if (app === 'aims') return { roles: [], grants: [], decision: { allowed: true } }
    return {
      roles: globalAdmin ? ['system_admin'] : [],
      grants: [{ permissions: [{ appCode: 'altoc', resourceCode: 'contract', action: 'edit' }], scopes: [{ dimension: 'department', predicate: 'tree', value: 'dept-root' }] }]
    }
  }
  globalThis.__activationDirectory = async (...args) => {
    directories.push(args)
    return { data: { tree: [{ deptCode: 'dept-root', children: [{ deptCode: 'dept-child' }] }] } }
  }
  globalThis.__activationTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: { activated: true } } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__activationSession'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__activationAuth(...args)'
    if (specifier.endsWith('/directoryApi')) source = 'export const fetchDirectoryApi=(...args)=>globalThis.__activationDirectory(...args)'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__activationTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
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
    router.post('/altoc/api/v1/contracts/:contractCode/activate-delivery', (await import('../server/routes/altoc/api/v1/contracts/[contractCode]/activate-delivery.post.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app)); await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, body = {}, key = 'activation-1') => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) })
      return { status: response.status, headers: response.headers }
    }
    assert.equal((await request('/altoc/api/v1/contracts/CON-1/activate-delivery', { authorization: { allowed: true } })).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await request('/altoc/api/v1/contracts/CON-1/activate-delivery', {}, '')).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await request('/altoc/api/v1/contracts/CON-1/activate-delivery?allowed=true')).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await request('/altoc/api/v1/contracts/CON-1/activate-delivery')).status, 200)
    assert.equal(directories.length, 1)
    const command = calls.at(-1)
    assert.equal(command.path, '/v1/enterprise/altoc/contracts:activate-delivery')
    assert.equal(command.options.appCode, 'enterprise')
    assert.equal(command.options.scope, 'altoc:contract:activate-delivery')
    assert.equal(command.options.idempotencyKey, 'activation-1')
    assert.deepEqual(command.options.body.authorization.departmentCodes, ['dept-root', 'dept-child'])
    assert.equal(command.options.body.authorization.actorUid, 'person-a')
    assert.equal(command.options.body.authorization.tenant, 'tenant-a')
    assert.equal(command.options.body.authorization.deployment, 'enterprise-test')
    assert.equal(command.options.body.authorization.contractCode, 'CON-1')
    assert.equal(command.options.body.authorization.idempotencyKey, 'activation-1')
    assert.equal(command.options.body.aims_authorization.resource, 'projects')
    assert.equal(command.options.body.aims_authorization.action, 'create')
    assert.equal(command.options.body.aims_authorization.access, undefined)
    assert.ok(command.options.body.authorization.expiresAt - Date.now() <= 15_000)
    denyAims = true
    assert.equal((await request('/altoc/api/v1/contracts/CON-2/activate-delivery')).status, 403)
    assert.equal(calls.length, 1)
    denyAims = false; denyAltoc = true
    assert.equal((await request('/altoc/api/v1/contracts/CON-3/activate-delivery')).status, 403)
    assert.equal(calls.length, 1)
    denyAltoc = false; globalAdmin = true
    assert.equal((await request('/altoc/api/v1/contracts/CON-4/activate-delivery')).status, 200)
    assert.equal(calls.at(-1).options.body.authorization.access, 'all')
    assert.equal(directories.length, 2)
    assert.ok(checks.every(check => check.uid === 'person-a'))
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister(); globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__activationSession; delete globalThis.__activationAuth; delete globalThis.__activationDirectory; delete globalThis.__activationTransport
  }
})
