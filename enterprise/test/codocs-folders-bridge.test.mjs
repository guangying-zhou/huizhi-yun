import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs folder detail mutations bridge exact scoped operations', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const preparations = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsFolderSession
  const oldAuthorization = globalThis.__codocsFolderAuthorization
  const oldTransport = globalThis.__codocsFolderTransport
  const oldPrepare = globalThis.__codocsFolderPrepare
  const oldHash = globalThis.__codocsFolderHash
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsFolderSession = session
  globalThis.__codocsFolderAuthorization = { resources: { documents: ['view', 'edit'] }, actionPolicies: {} }
  globalThis.__codocsFolderPrepare = async (_event, options) => { preparations.push(options); return true }
  globalThis.__codocsFolderHash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  globalThis.__codocsFolderTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { success: true } }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsFolderSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsFolderPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsFolderTransport(...args);export const hashServiceCommandPayload=async payload=>globalThis.__codocsFolderHash(payload)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsFolderAuthorization'
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
    router.post('/folders', (await import('../server/routes/codocs/api/folders/index.post.ts')).default)
    router.get('/folders/:id', (await import('../server/routes/codocs/api/folders/[id].get.ts')).default)
    router.patch('/folders/:id', (await import('../server/routes/codocs/api/folders/[id].patch.ts')).default)
    router.delete('/folders/:id', (await import('../server/routes/codocs/api/folders/[id].delete.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsFolderSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = (path, method, body, headers = {}) => fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined
    })

    const get = await request('/folders/42', 'GET')
    assert.equal(get.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/personal-folders:view')
    assert.equal(calls.at(-1).options.scope, 'codocs:personal-folders:read')
    assert.equal(calls.at(-1).options.body.objectId, '42')
    assert.equal(calls.at(-1).options.body.authorization.actorUid, 'person-a')
    assert.equal(calls.at(-1).options.body.authorization.tenant, 'tenant-a')
    assert.equal(calls.at(-1).options.body.authorization.deployment, 'enterprise-test')
    assert.equal(calls.at(-1).options.body.authorization.resource, 'personal-folders')
    assert.equal(calls.at(-1).options.body.authorization.action, 'read')
    assert.ok(calls.at(-1).options.body.authorization.expiresAt > Date.now())
    assert.equal(preparations.at(-1).scope, 'codocs:personal-folders:read')
    assert.equal(calls.at(-1).options.idempotencyKey, undefined)

    globalThis.__codocsFolderAuthorization = { resources: { documents: ['create', 'view', 'edit'] }, actionPolicies: {} }
    const creationKey = 'folder-create-0001'
    const createPayload = { name: 'New folder', folder_type: 'private', parent_id: 7, owner_uid: 'person-a' }
    const create = await request('/folders', 'POST', createPayload, { 'Idempotency-Key': creationKey })
    assert.equal(create.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/personal-folders:create')
    assert.equal(calls.at(-1).options.scope, 'codocs:personal-folders:create')
    assert.equal(calls.at(-1).options.idempotencyKey, creationKey)
    assert.equal(calls.at(-1).options.body.objectId, undefined)
    assert.deepEqual(calls.at(-1).options.body.payload, { name: 'New folder', folder_type: 'private', parent_id: 7 })
    assert.equal(calls.at(-1).options.body.authorization.actorUid, 'person-a')
    assert.equal(calls.at(-1).options.body.authorization.tenant, 'tenant-a')
    assert.equal(calls.at(-1).options.body.authorization.deployment, 'enterprise-test')
    assert.equal(calls.at(-1).options.body.authorization.action, 'create')
    assert.equal(preparations.at(-1).scope, 'codocs:personal-folders:create')

    for (const [body, headers, expected] of [
      [{ name: 'Missing key', folder_type: 'private' }, {}, 400],
      [{ name: 'Bad key', folder_type: 'private' }, { 'Idempotency-Key': 'short' }, 400],
      [{ name: 'Other owner', folder_type: 'private', owner_uid: 'person-b' }, { 'Idempotency-Key': creationKey }, 403],
      [{ name: 'Unknown', folder_type: 'private', extra: true }, { 'Idempotency-Key': creationKey }, 400]
    ]) {
      const before = calls.length
      assert.equal((await request('/folders', 'POST', body, headers)).status, expected)
      assert.equal(calls.length, before)
    }

    globalThis.__codocsFolderAuthorization = { resources: { documents: ['view', 'edit'] }, actionPolicies: {} }

    const payload = { name: 'Renamed', parent_id: 9 }
    const patch = await request('/folders/42', 'PATCH', payload)
    assert.equal(patch.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/personal-folders:update')
    assert.equal(calls.at(-1).options.scope, 'codocs:personal-folders:edit')
    assert.deepEqual(calls.at(-1).options.body.payload, payload)
    assert.equal(calls.at(-1).options.body.authorization.action, 'edit')
    const updateHash = globalThis.__codocsFolderHash({ tenant: 'tenant-a', deployment: 'enterprise-test', actor: 'person-a', id: '42', action: 'update', payload })
    assert.equal(calls.at(-1).options.idempotencyKey, `codocs:folder:${updateHash}`)

    const repeatPatch = await request('/folders/42', 'PATCH', payload)
    assert.equal(repeatPatch.status, 200)
    assert.equal(calls.at(-1).options.idempotencyKey, `codocs:folder:${updateHash}`)

    const remove = await request('/folders/42', 'DELETE')
    assert.equal(remove.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/personal-folders:delete')
    assert.equal(calls.at(-1).options.scope, 'codocs:personal-folders:delete')
    assert.equal(calls.at(-1).options.body.authorization.action, 'delete')
    const deleteHash = globalThis.__codocsFolderHash({ tenant: 'tenant-a', deployment: 'enterprise-test', actor: 'person-a', id: '42', action: 'delete', payload: {} })
    assert.equal(calls.at(-1).options.idempotencyKey, `codocs:folder:${deleteHash}`)

    for (const path of ['/folders/0', '/folders/-1', '/folders/1.5', '/folders/not-an-id', '/folders/42?x=1']) {
      const before = calls.length
      assert.equal((await request(path, 'GET')).status, 400, path)
      assert.equal(calls.length, before)
    }

    for (const body of [{}, { owner_uid: 'victim' }, { ossPath: 'private/path' }, { name: 'ok', unknown: true }]) {
      const before = calls.length
      assert.equal((await request('/folders/42', 'PATCH', body)).status, 400)
      assert.equal(calls.length, before)
    }

    globalThis.__codocsFolderAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    const beforeReadonly = calls.length
    assert.equal((await request('/folders/42', 'PATCH', { name: 'readonly' })).status, 403)
    assert.equal((await request('/folders/42', 'DELETE')).status, 403)
    assert.equal(calls.length, beforeReadonly)
    assert.equal((await request('/folders/42', 'GET')).status, 200)

    globalThis.__codocsFolderSession = { ...session, authenticated: false }
    assert.equal((await request('/folders/42', 'GET')).status, 401)
    globalThis.__codocsFolderSession = session
    globalThis.__codocsFolderAuthorization = { resources: { documents: ['view', 'edit'] }, actionPolicies: {} }
    globalThis.__codocsFolderTransport = async () => ({ handled: false })
    assert.equal((await request('/folders/42', 'GET')).status, 503)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsFolderSession = oldSession
    globalThis.__codocsFolderAuthorization = oldAuthorization
    globalThis.__codocsFolderTransport = oldTransport
    globalThis.__codocsFolderPrepare = oldPrepare
    globalThis.__codocsFolderHash = oldHash
  }
})
