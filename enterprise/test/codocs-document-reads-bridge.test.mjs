import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs document reads use the four explicit runtime operations and signed user permit', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = [], preparations = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsReadSession
  const oldAuth = globalThis.__codocsReadAuthorization
  const oldTransport = globalThis.__codocsReadTransport
  const oldPrepare = globalThis.__codocsReadPrepare
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsReadSession = session
  globalThis.__codocsReadAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
  globalThis.__codocsReadTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: path.endsWith(':view') ? { success: true, data: { uuid: 'doc-1', doc_type: 'private', oss_path: null } } : { success: true, data: { items: [], total: 0 } } }
  }
  globalThis.__codocsReadPrepare = async (_event, options) => { preparations.push(options); return true }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/objectStorage')) source = 'export const createAliOssCompatibleClient=()=>{throw Error("Unexpected storage access in metadata transport test")}'
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsReadSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsReadPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsReadTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsReadAuthorization'
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
    const app = createApp(), router = createRouter()
    router.get('/documents', (await import('../server/routes/codocs/api/documents/index.get.ts')).default)
    router.get('/documents/trash', (await import('../server/routes/codocs/api/documents/trash.get.ts')).default)
    router.get('/documents/check-name', (await import('../server/routes/codocs/api/documents/check-name.get.ts')).default)
    router.get('/documents/:uuid', (await import('../server/routes/codocs/api/documents/[uuid].get.ts')).default)
    router.get('/folders', (await import('../server/routes/codocs/api/folders/index.get.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsReadSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    const expectRead = async (path, operation, runtimePath, query = {}) => {
      const before = calls.length
      const response = await fetch(base + path)
      assert.equal(response.status, 200, path)
      assert.equal(calls.length, before + 1)
      const call = calls.at(-1)
      assert.equal(call.path, runtimePath)
      assert.equal(call.options.appCode, 'enterprise')
      assert.equal(call.options.scope, 'codocs:personal-documents:read')
      assert.equal(call.options.body.authorization.actorUid, 'person-a')
      assert.equal(call.options.body.authorization.tenant, 'tenant-a')
      assert.equal(call.options.body.authorization.deployment, 'enterprise-test')
      assert.equal(call.options.body.authorization.resource, 'personal-documents')
      assert.equal(call.options.body.authorization.action, 'read')
      assert.ok(call.options.body.authorization.expiresAt > Date.now())
      assert.ok(call.options.body.authorization.expiresAt <= Date.now() + 15_000)
      assert.equal(preparations.at(-1).scope, 'codocs:personal-documents:read')
      assert.equal(preparations.at(-1).method, 'POST')
      for (const [key, value] of Object.entries(query)) assert.equal(call.options.body.query[key], value, `${path} query ${key}`)
      return call
    }

    const personalList = await expectRead('/documents?type=private&page=2&owner=person-a', 'codocs.personal-document-list', '/v1/enterprise/codocs/personal-documents:list', { type: 'private', page: '2' })
    assert.equal(personalList.options.body.query.owner, undefined)
    assert.equal(personalList.options.body.query.owner_uid, undefined)
    const view = await expectRead('/documents/doc-1', 'codocs.personal-document-view', '/v1/enterprise/codocs/personal-documents:view')
    assert.equal(view.options.body.code, 'doc-1')
    const trash = await expectRead('/documents/trash?type=private&owner_uid=person-a', 'codocs.personal-document-trash', '/v1/enterprise/codocs/personal-documents:trash', { type: 'private' })
    assert.equal(trash.options.body.query.owner_uid, undefined)
    const checkName = await expectRead('/documents/check-name?title=Draft&doc_type=private&folder_id=7&exclude_uuid=doc-1&owner_uid=person-a', 'codocs.personal-document-check-name', '/v1/enterprise/codocs/personal-documents:check-name', {
      title: 'Draft', doc_type: 'private', folder_id: '7', exclude_uuid: 'doc-1'
    })
    assert.equal(checkName.options.body.query.owner_uid, undefined)
    await expectRead('/folders?folder_type=private', 'codocs.personal-folder-list', '/v1/enterprise/codocs/personal-documents:folders', { folder_type: 'private' })

    for (const path of ['/documents?owner=person-b', '/documents?owner_uid=person-b']) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 403)
      assert.equal(calls.length, before)
    }
    const beforeArray = calls.length
    assert.equal((await fetch(base + '/documents?type=private&type=worklog')).status, 400)
    assert.equal(calls.length, beforeArray)
    const beforeCheckOtherOwner = calls.length
    assert.equal((await fetch(base + '/documents/check-name?title=Draft&owner_uid=person-b')).status, 403)
    assert.equal(calls.length, beforeCheckOtherOwner)
    const beforeCheckDuplicate = calls.length
    assert.equal((await fetch(base + '/documents/check-name?title=Draft&title=Other')).status, 400)
    assert.equal(calls.length, beforeCheckDuplicate)

    globalThis.__codocsReadAuthorization = { resources: {}, actionPolicies: {} }
    const beforePermission = calls.length
    assert.equal((await fetch(base + '/documents')).status, 403)
    assert.equal(calls.length, beforePermission)
    const beforeCheckPermission = calls.length
    assert.equal((await fetch(base + '/documents/check-name?title=Draft')).status, 403)
    assert.equal(calls.length, beforeCheckPermission)
    globalThis.__codocsReadAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }

    globalThis.__codocsReadSession = { ...session, authenticated: false }
    const beforeUnauthenticated = calls.length
    assert.equal((await fetch(base + '/documents')).status, 401)
    assert.equal(calls.length, beforeUnauthenticated)
    globalThis.__codocsReadSession = session

    globalThis.__codocsReadTransport = async () => ({ handled: false })
    assert.equal((await fetch(base + '/documents/check-name?title=Draft')).status, 503)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsReadSession = oldSession
    globalThis.__codocsReadAuthorization = oldAuth
    globalThis.__codocsReadTransport = oldTransport
    globalThis.__codocsReadPrepare = oldPrepare
  }
})
