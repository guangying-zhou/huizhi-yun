import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('completed save replay never overwrites a later edit or writes storage for a conflicting command', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'owner', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const records = new Map(), storageCalls = [], runtimeCalls = []
  let content = 'initial', version = 1, loseResponse = true
  let allowed = true, writable = true, unavailable = false, revokeDuringPut = false, failStorage = false
  let versionHeader = 'x-oss-version-id'
  const etag = () => `"${createHash('sha256').update(content).digest('hex')}"`
  const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode })
  const keyHash = body => JSON.stringify([body.code, body.payload.title, body.payload.content_sha256 || '', body.payload.content_size || 0, body.payload.save_mode || ''])
  const globals = {
    useRuntimeConfig: () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } }),
    defineEventHandler: handler => handler,
    __updateSession: session,
    __updateAuthorization: () => ({ resources: { documents: allowed ? ['edit'] : ['view'] }, actionPolicies: {} }),
    __updateRuntime: async (_event, path, options) => {
      runtimeCalls.push({ path, options })
      if (unavailable) throw fail(503, 'runtime unavailable')
      const body = options.body
      if (path.endsWith('personal-documents:view')) return { handled: true, data: { success: true, data: { uuid: body.code, oss_path: 'codocs/users/owner/doc.md', doc_type: 'private' } } }
      if (!writable) throw fail(403, 'read-only share')
      const key = options.idempotencyKey, digest = keyHash(body), previous = records.get(key)
      if (previous && previous !== digest) throw fail(409, 'command mismatch')
      if (path.endsWith('personal-documents:update-plan')) return { handled: true, data: { success: true, data: { uuid: body.code, replayed: Boolean(previous), oss_path: 'codocs/users/owner/doc.md', doc_type: 'private' } } }
      assert.ok(path.endsWith('personal-documents:update'))
      records.set(key, digest)
      if (loseResponse) { loseResponse = false; throw fail(503, 'commit succeeded; response lost') }
      return { handled: true, data: { success: true, data: { uuid: body.code, updated: true } } }
    },
    __updateOSS: {
      async head() { storageCalls.push('head'); return { meta: {}, res: { headers: { etag: etag(), 'x-oss-version-id': String(version) } } } },
      async put(_path, bytes, options) {
        storageCalls.push('put')
        if (failStorage) throw fail(503, 'isolated storage failure')
        content = bytes.toString(); version++
        if (revokeDuringPut) allowed = false
        return { res: { headers: { [versionHeader]: String(version) } } }
      }
    }
  }
  const old = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__updateSession'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async()=>true;export const maybeCallTenantRuntime=(...args)=>globalThis.__updateRuntime(...args)'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__updateAuthorization()'
    if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
    if (specifier.endsWith('/oss')) source = 'export const createRuntimeOSSClient=async()=>globalThis.__updateOSS'
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
    router.put('/documents/:uuid', (await import('../server/routes/codocs/api/documents/[uuid].put.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const save = (key, value) => fetch(`http://127.0.0.1:${server.address().port}/documents/doc-1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ title: 'Title', content: value })
    })
    assert.equal((await save('save-attempt-a', 'edit A')).status, 503)
    assert.equal(records.size, 1, 'the first database transaction committed despite lost response')
    assert.equal((await save('save-attempt-b', 'edit B')).status, 200)
    assert.equal(content, 'edit B')
    const beforeReplay = storageCalls.length
    assert.equal((await save('save-attempt-a', 'edit A')).status, 200)
    assert.equal(content, 'edit B', 'an acknowledged old command must never replace newer bytes')
    assert.equal(storageCalls.length, beforeReplay, 'completed replay must not even HEAD storage')
    assert.equal(records.size, 2)
    assert.equal((await save('save-attempt-a', 'changed payload')).status, 409)
    assert.equal(storageCalls.length, beforeReplay)
    allowed = false
    assert.equal((await save('save-attempt-a', 'edit A')).status, 403)
    allowed = true; writable = false
    assert.equal((await save('read-only-share', 'forbidden')).status, 403)
    assert.equal(storageCalls.length, beforeReplay, 'object write ACL must be checked before storage')
    writable = true; unavailable = true
    assert.equal((await save('outage-attempt', 'no write')).status, 503)
    assert.equal(storageCalls.length, beforeReplay)
    unavailable = false; failStorage = true
    assert.equal((await save('storage-failure', 'not stored')).status, 503)
    assert.equal(content, 'edit B')
    assert.equal(records.size, 2)
    failStorage = false; revokeDuringPut = true
    assert.equal((await save('revoked-during-put', 'pending content')).status, 403)
    assert.equal(records.size, 2, 'lost permission must prevent metadata commit after storage')
    allowed = true; revokeDuringPut = false; versionHeader = 'x-amz-version-id'
    assert.equal((await save('s3-compatible-version', 'edit through S3')).status, 200)
    assert.equal(records.size, 3, 'S3 version receipt must reach the Runtime commit')
    assert.equal(runtimeCalls.at(-1).options.body.payload.oss_version_id, String(version))
    for (const call of runtimeCalls.filter(call => call.path.endsWith('update-plan'))) {
      assert.equal(call.options.scope, 'codocs:personal-documents:edit')
      assert.equal(call.options.body.authorization.actorUid, 'owner')
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
})
