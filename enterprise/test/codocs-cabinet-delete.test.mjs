import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs cabinet delete uses the exact Runtime delete capability and no OSS', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const preparations = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  let authorization = { resources: { documents: ['delete'] }, actionPolicies: {} }
  let transportMode = 'ok'
  let prepareCount = 0
  let revokeAfterPrepareCount = null
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__codocsCabinetDeleteSession', '__codocsCabinetDeleteAuthorization', '__codocsCabinetDeleteMode', '__codocsCabinetDeleteCalls', '__codocsCabinetDeletePrepareCount', '__codocsCabinetDeleteRevokeAfterPrepareCount'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsCabinetDeleteSession = session
  globalThis.__codocsCabinetDeleteAuthorization = () => authorization
  globalThis.__codocsCabinetDeleteMode = () => transportMode
  globalThis.__codocsCabinetDeleteCalls = calls
  globalThis.__codocsCabinetDeletePrepareCount = () => prepareCount
  globalThis.__codocsCabinetDeleteRevokeAfterPrepareCount = () => revokeAfterPrepareCount

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = `export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsCabinetDeleteSession`
      if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
      if (specifier.endsWith('/tenantRuntimeClient')) source = `export const prepareTenantRuntime=async(...args)=>{const next=globalThis.__codocsCabinetDeletePrepareCount()+1;globalThis.__codocsCabinetDeletePrepareCount=()=>next;globalThis.__codocsCabinetDeleteCalls.push({kind:'prepare',args});return true};export const maybeCallTenantRuntime=async(...args)=>{const [event,path,options]=args;globalThis.__codocsCabinetDeleteCalls.push({kind:'runtime',event,path,options});if(globalThis.__codocsCabinetDeleteMode()!=='ok'&&globalThis.__codocsCabinetDeleteMode()!=='malformed'){const e=new Error('runtime secret');e.statusCode=Number(globalThis.__codocsCabinetDeleteMode());throw e}return {handled:true,data:globalThis.__codocsCabinetDeleteMode()==='malformed'?{success:true,data:{uuid:'other',deleted:false}}:{success:true,data:{uuid:options.body.code,deleted:true}}}}`
      if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsCabinetDeleteRevokeAfterPrepareCount()===globalThis.__codocsCabinetDeletePrepareCount()?{resources:{},actionPolicies:{}}:globalThis.__codocsCabinetDeleteAuthorization()`
      if (specifier.endsWith('/objectStorage') || specifier.endsWith('/oss')) source = "export const createRuntimeOSSClient=()=>{throw Error('OSS must not be called')}"
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
    router.delete('/codocs/api/cabinet/:uuid', (await import('../server/routes/codocs/api/cabinet/[uuid].delete.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsCabinetDeleteSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const key = 'cabinet-delete-1'
    const request = (url = '/codocs/api/cabinet/file-1', headers = { 'Idempotency-Key': key }, body) => fetch(base + url, { method: 'DELETE', headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

    let response = await request()
    assert.equal(response.status, 200)
    const call = calls.at(-1)
    assert.equal(call.path, '/v1/enterprise/codocs/personal-cabinet:delete')
    assert.equal(call.options.appCode, 'enterprise')
    assert.equal(call.options.scope, 'codocs:personal-cabinet:delete')
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.idempotencyKey, key)
    assert.equal(call.options.body.code, 'file-1')
    assert.deepEqual(call.options.body.authorization, { actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', resource: 'personal-cabinet', action: 'delete', expiresAt: call.options.body.authorization.expiresAt })
    assert.ok(call.options.body.authorization.expiresAt > Date.now())
    assert.ok(call.options.body.authorization.expiresAt <= Date.now() + 15_000)
    const prepareCall = calls.findLast(entry => entry.kind === 'prepare')
    assert.equal(prepareCall.args[1].appCode, 'enterprise')
    assert.equal(prepareCall.args[1].scope, 'codocs:personal-cabinet:delete')
    assert.equal(prepareCall.args[1].method, 'POST')

    response = await request()
    assert.equal(response.status, 200)
    assert.equal(calls.at(-1).options.idempotencyKey, key)

    const beforeInvalid = calls.length
    for (const [url, headers, body] of [
      ['/codocs/api/cabinet/not valid', { 'Idempotency-Key': key }],
      ['/codocs/api/cabinet/file-1?query=1', { 'Idempotency-Key': key }],
      ['/codocs/api/cabinet/file-1', {}],
      ['/codocs/api/cabinet/file-1', { 'Idempotency-Key': 'short' }],
      ['/codocs/api/cabinet/file-1', { 'Idempotency-Key': key }, { injected: true }]
    ]) assert.equal((await request(url, headers, body)).status, 400)
    assert.equal(calls.length, beforeInvalid)

    for (const granted of ['view', 'edit']) {
      authorization = { resources: { documents: [granted] }, actionPolicies: {} }
      const beforeDenied = calls.filter(entry => entry.kind === 'runtime').length
      assert.equal((await request('/codocs/api/cabinet/file-denied')).status, 403)
      assert.equal(calls.filter(entry => entry.kind === 'runtime').length, beforeDenied)
    }
    authorization = { resources: { documents: ['delete'] }, actionPolicies: {} }

    revokeAfterPrepareCount = globalThis.__codocsCabinetDeletePrepareCount() + 1
    const beforeRevoke = calls.filter(entry => entry.kind === 'runtime').length
    assert.equal((await request('/codocs/api/cabinet/file-revoked')).status, 403)
    assert.equal(calls.filter(entry => entry.kind === 'runtime').length, beforeRevoke)
    revokeAfterPrepareCount = null

    for (const code of [403, 409, 503]) {
      transportMode = String(code)
      const beforeRuntimeError = calls.filter(entry => entry.kind === 'runtime').length
      assert.equal((await request(`/codocs/api/cabinet/file-${code}`, { 'Idempotency-Key': `key-${code}-ok` })).status, code)
      assert.equal(calls.filter(entry => entry.kind === 'runtime').length, beforeRuntimeError + 1)
    }
    transportMode = 'malformed'
    assert.equal((await request('/codocs/api/cabinet/file-malformed')).status, 503)
    transportMode = 'ok'
    globalThis.__codocsCabinetDeleteSession = { ...session, authenticated: false }
    const beforeUnauthenticated = calls.length
    assert.equal((await request()).status, 401)
    assert.equal(calls.length, beforeUnauthenticated)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
