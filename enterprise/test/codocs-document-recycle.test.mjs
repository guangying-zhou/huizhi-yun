import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs recycle route requires delete capability and forwards a fixed runtime command', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const preparations = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsRecycleSession
  const oldAuth = globalThis.__codocsRecycleAuthorization
  const oldPrepare = globalThis.__codocsRecyclePrepare
  const oldTransport = globalThis.__codocsRecycleTransport
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsRecycleSession = session
  globalThis.__codocsRecycleAuthorization = { resources: { documents: ['delete'] }, actionPolicies: {} }
  globalThis.__codocsRecyclePrepare = async (_event, options) => { preparations.push(options); return true }
  globalThis.__codocsRecycleTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { success: true, data: { recycled: true } } }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/objectStorage') || specifier.endsWith('/oss')) source = 'export const createAliOssCompatibleClient=()=>{throw Error("OSS must not be called")};export const createRuntimeOSSClient=()=>{throw Error("OSS must not be called")}'
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsRecycleSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsRecyclePrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsRecycleTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsRecycleAuthorization'
      if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  let server
  try {
    const app = createApp()
    const router = createRouter()
    router.delete('/documents/:uuid', (await import('../server/routes/codocs/api/documents/[uuid].delete.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsRecycleSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const key = 'recycle-key-1'
    const request = (url = '/documents/doc-1', headers = { 'Idempotency-Key': key }, body) => fetch(base + url, { method: 'DELETE', headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

    const first = await request()
    assert.equal(first.status, 200)
    const call = calls[0]
    assert.equal(call.path, '/v1/enterprise/codocs/personal-documents:recycle')
    assert.equal(call.options.scope, 'codocs:personal-documents:delete')
    assert.equal(call.options.appCode, 'enterprise')
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.body.code, 'doc-1')
    assert.deepEqual(call.options.body.authorization, {
      actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test',
      resource: 'personal-documents', action: 'delete', expiresAt: call.options.body.authorization.expiresAt
    })
    assert.ok(call.options.body.authorization.expiresAt > Date.now())
    assert.ok(call.options.body.authorization.expiresAt <= Date.now() + 15_000)
    assert.equal(call.options.idempotencyKey, key)
    assert.equal(preparations.at(-1).scope, 'codocs:personal-documents:delete')
    assert.equal(preparations.at(-1).method, 'POST')

    const second = await request()
    assert.equal(second.status, 200)
    assert.equal(calls.at(-1).options.idempotencyKey, key)

    for (const badUrl of ['/documents/not valid', '/documents/%21bad']) {
      const before = calls.length
      assert.equal((await request(badUrl)).status, 400)
      assert.equal(calls.length, before)
    }
    const beforeInvalid = calls.length
    assert.equal((await request('/documents/doc-1?x=1')).status, 400)
    assert.equal((await request('/documents/doc-1', {})).status, 400)
    assert.equal((await request('/documents/doc-1', { 'Idempotency-Key': 'short' })).status, 400)
    assert.equal((await request('/documents/doc-1', { 'Idempotency-Key': key }, { injected: true })).status, 400)
    assert.equal(calls.length, beforeInvalid)

    globalThis.__codocsRecycleAuthorization = { resources: { documents: ['edit'] }, actionPolicies: {} }
    const beforeEdit = calls.length
    assert.equal((await request()).status, 403)
    assert.equal(calls.length, beforeEdit)
    globalThis.__codocsRecycleAuthorization = { resources: { documents: ['delete'] }, actionPolicies: {} }

    globalThis.__codocsRecyclePrepare = async (_event, options) => {
      preparations.push(options)
      globalThis.__codocsRecycleAuthorization = { resources: {}, actionPolicies: {} }
      return true
    }
    const beforeFresh = calls.length
    assert.equal((await request('/documents/doc-fresh')).status, 403)
    assert.equal(calls.length, beforeFresh)
    globalThis.__codocsRecyclePrepare = async (_event, options) => { preparations.push(options); return true }
    globalThis.__codocsRecycleAuthorization = { resources: { documents: ['delete'] }, actionPolicies: {} }

    for (const statusCode of [403, 409, 503]) {
      globalThis.__codocsRecycleTransport = async (_event, path, options) => {
        calls.push({ path, options })
        const error = new Error(`runtime-${statusCode}`)
        error.statusCode = statusCode
        throw error
      }
      const beforeError = calls.length
      assert.equal((await request('/documents/doc-error', { 'Idempotency-Key': `error-${statusCode}-key` })).status, statusCode)
      assert.equal(calls.length, beforeError + 1)
    }

    globalThis.__codocsRecycleSession = { ...session, authenticated: false }
    const beforeUnauthenticated = calls.length
    assert.equal((await request()).status, 401)
    assert.equal(calls.length, beforeUnauthenticated)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsRecycleSession = oldSession
    globalThis.__codocsRecycleAuthorization = oldAuth
    globalThis.__codocsRecyclePrepare = oldPrepare
    globalThis.__codocsRecycleTransport = oldTransport
  }
})
