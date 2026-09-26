import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs document creation binds actor, runtime idempotency, and conditional OSS writes', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const runtimeCalls = []
  const preparations = []
  const ossFactories = []
  const ossCalls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const validDoc = { uuid: '123e4567-e89b-12d3-a456-426614174000', title: 'New doc', doc_type: 'private', oss_path: 'codocs/document-creations/123e4567-e89b-12d3-a456-426614174000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md' }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsCreationSession
  const oldAuth = globalThis.__codocsCreationAuthorization
  const oldTransport = globalThis.__codocsCreationTransport
  const oldPrepare = globalThis.__codocsCreationPrepare
  const oldOss = globalThis.__codocsCreationOss
  const oldOssMode = globalThis.__codocsCreationOssMode
  const oldResponse = globalThis.__codocsCreationResponse

  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsCreationSession = session
  globalThis.__codocsCreationAuthorization = { resources: { documents: ['create'] }, actionPolicies: {} }
  globalThis.__codocsCreationResponse = { success: true, data: validDoc }
  globalThis.__codocsCreationPrepare = async (_event, options) => { preparations.push(options); return true }
  globalThis.__codocsCreationTransport = async (_event, path, options) => {
    runtimeCalls.push({ path, options })
    if (globalThis.__codocsCreationResponse instanceof Error) throw globalThis.__codocsCreationResponse
    return { handled: true, data: globalThis.__codocsCreationResponse }
  }
  globalThis.__codocsCreationOss = async options => {
    ossFactories.push(options)
    const mode = globalThis.__codocsCreationOssMode || 'missing'
    let heads = 0
    return {
      async head(path) {
        ossCalls.push({ method: 'head', path, options })
        heads += 1
        if (mode === 'existing' || mode === 'conflict-won') return { etag: 'existing' }
        if (mode === 'head-fails') {
          const error = new Error('head storage unavailable')
          error.statusCode = 500
          throw error
        }
        if (mode === 'put-fails' || mode === 'missing' || mode === 'conflict' || mode === 'conflict-missing') {
          const error = new Error('NoSuchKey')
          error.code = 'NoSuchKey'
          if (mode === 'conflict' && heads > 1) return { etag: 'winner' }
          throw error
        }
        throw new Error('unexpected head mode')
      },
      async put(path, bytes, options) {
        ossCalls.push({ method: 'put', path, bytes, options })
        if (mode === 'put-fails') throw new Error('secret storage failure')
        if (mode === 'conflict' || mode === 'conflict-missing') {
          const error = new Error('already exists')
          error.statusCode = 409
          throw error
        }
        return { etag: 'created' }
      }
    }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/oss')) source = 'export const createRuntimeOSSClient=async(...args)=>globalThis.__codocsCreationOss(...args)'
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsCreationSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsCreationPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsCreationTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsCreationAuthorization'
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
    router.post('/documents', (await import('../server/routes/codocs/api/documents/index.post.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsCreationSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const body = { title: 'New doc', doc_type: 'private', folder_id: 7, content: '# hello' }
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'create-doc-key-1' }
    globalThis.__codocsCreationOssMode = 'missing'

    const response = await fetch(`${base}/documents`, { method: 'POST', headers, body: JSON.stringify(body) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true, data: validDoc })
    assert.equal(runtimeCalls[0].path, '/v1/enterprise/codocs/personal-documents:create')
    assert.equal(runtimeCalls[0].options.scope, 'codocs:personal-documents:create')
    assert.equal(runtimeCalls[0].options.appCode, 'enterprise')
    assert.equal(runtimeCalls[0].options.method, 'POST')
    assert.equal(runtimeCalls[0].options.body.authorization.actorUid, 'person-a')
    assert.equal(runtimeCalls[0].options.body.authorization.tenant, 'tenant-a')
    assert.equal(runtimeCalls[0].options.body.authorization.deployment, 'enterprise-test')
    assert.equal(runtimeCalls[0].options.body.authorization.resource, 'personal-documents')
    assert.equal(runtimeCalls[0].options.body.authorization.action, 'create')
    assert.ok(runtimeCalls[0].options.body.authorization.expiresAt > Date.now())
    assert.equal(runtimeCalls[0].options.idempotencyKey, 'create-doc-key-1')
    assert.equal(runtimeCalls[0].options.body.payload.title, 'New doc')
    assert.equal(runtimeCalls[0].options.body.payload.folder_id, 7)
    assert.equal(runtimeCalls[0].options.body.payload.content_size, Buffer.byteLength('# hello'))
    assert.equal(runtimeCalls[0].options.body.payload.content_sha256, createHash('sha256').update('# hello').digest('hex'))
    assert.equal(preparations.at(-1).scope, 'codocs:personal-documents:create')
    assert.equal(preparations.at(-1).method, 'POST')
    assert.equal(ossFactories[0].event !== undefined, true)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, 1)
    assert.equal(ossCalls.at(-1).options.forbidOverwrite, true)
    assert.equal(ossCalls.at(-1).options.headers['Content-Type'], 'text/markdown; charset=utf-8')

    const beforeReplayPut = ossCalls.filter(call => call.method === 'put').length
    globalThis.__codocsCreationOssMode = 'existing'
    const replay = await fetch(`${base}/documents`, { method: 'POST', headers, body: JSON.stringify(body) })
    assert.equal(replay.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeReplayPut)

    const beforeInvalidRuntime = runtimeCalls.length
    const invalidBodies = [
      { ...body, owner_uid: 'person-b' },
      { ...body, oss_path: 'codocs/escape' },
      { ...body, uuid: validDoc.uuid },
      { ...body, doc_type: 'pdf' },
      { ...body, title: 'x'.repeat(256) }
    ]
    for (const invalidBody of invalidBodies) {
      const invalid = await fetch(`${base}/documents`, { method: 'POST', headers, body: JSON.stringify(invalidBody) })
      assert.ok([400, 403].includes(invalid.status))
    }
    assert.equal(runtimeCalls.length, beforeInvalidRuntime)
    assert.equal(ossCalls.length, 3)
    const oversized = await fetch(`${base}/documents`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'oversized-key' },
      body: JSON.stringify({ ...body, content: 'x'.repeat(10 * 1024 * 1024 + 1) })
    })
    assert.equal(oversized.status, 413)
    assert.equal(runtimeCalls.length, beforeInvalidRuntime)
    assert.equal((await fetch(`${base}/documents?x=1`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400)
    assert.equal(runtimeCalls.length, beforeInvalidRuntime)

    globalThis.__codocsCreationAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    const beforeDeniedRuntime = runtimeCalls.length
    const beforeDeniedOss = ossCalls.length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 403)
    assert.equal(runtimeCalls.length, beforeDeniedRuntime)
    assert.equal(ossCalls.length, beforeDeniedOss)
    globalThis.__codocsCreationAuthorization = { resources: { documents: ['create'] }, actionPolicies: {} }

    globalThis.__codocsCreationResponse = Object.assign(new Error('runtime conflict'), { statusCode: 409 })
    const beforeRuntimeErrorOss = ossCalls.length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'runtime-error-key' }, body: JSON.stringify(body) })).status, 409)
    assert.equal(ossCalls.length, beforeRuntimeErrorOss)
    globalThis.__codocsCreationResponse = Object.assign(new Error('runtime forbidden'), { statusCode: 403 })
    const beforeRuntimeForbiddenOss = ossCalls.length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'runtime-forbid-key' }, body: JSON.stringify(body) })).status, 403)
    assert.equal(ossCalls.length, beforeRuntimeForbiddenOss)
    globalThis.__codocsCreationResponse = { success: true, data: { ...validDoc, uuid: 'bad', title: 'New doc' } }
    const beforeBadResponseOss = ossCalls.length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'bad-response-key' }, body: JSON.stringify(body) })).status, 503)
    assert.equal(ossCalls.length, beforeBadResponseOss)
    const beforeMalformedResponseFactories = ossFactories.length
    for (const [field, value] of [['oss_path', 'codocs/not-bound'], ['doc_type', 'slide'], ['title', 'Server title']]) {
      globalThis.__codocsCreationResponse = { success: true, data: { ...validDoc, [field]: value } }
      const beforeMalformedResponseOss = ossCalls.length
      const malformedResponse = await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `bad-${field}-key` }, body: JSON.stringify(body) })
      assert.equal(malformedResponse.status, 503)
      assert.equal(ossCalls.length, beforeMalformedResponseOss)
      assert.equal(ossFactories.length, beforeMalformedResponseFactories)
    }
    globalThis.__codocsCreationResponse = { success: true, data: validDoc }

    const beforeKeyValidationRuntime = runtimeCalls.length
    const beforeKeyValidationOss = ossCalls.length
    for (const invalidHeaders of [
      { 'Content-Type': 'application/json' },
      { ...headers, 'Idempotency-Key': 'short' },
      { ...headers, 'Idempotency-Key': 'has space-key' }
    ]) {
      assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: invalidHeaders, body: JSON.stringify(body) })).status, 400)
    }
    assert.equal(runtimeCalls.length, beforeKeyValidationRuntime)
    assert.equal(ossCalls.length, beforeKeyValidationOss)

    for (const invalidBody of [
      { ...body, doc_type: false },
      { ...body, doc_type: null },
      { ...body, content: 42 },
      { ...body, folder_id: 0 },
      { ...body, folder_id: 1.5 }
    ]) {
      const beforeFieldRuntime = runtimeCalls.length
      assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `field-${runtimeCalls.length}-key` }, body: JSON.stringify(invalidBody) })).status, 400)
      assert.equal(runtimeCalls.length, beforeFieldRuntime)
    }

    globalThis.__codocsCreationOssMode = 'head-fails'
    const beforeHeadFailurePuts = ossCalls.filter(call => call.method === 'put').length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'head-failure-key' }, body: JSON.stringify(body) })).status, 503)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeHeadFailurePuts)

    globalThis.__codocsCreationOssMode = 'put-fails'
    const failedPut = await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'repair-key' }, body: JSON.stringify(body) })
    assert.equal(failedPut.status, 503)
    assert.doesNotMatch(await failedPut.text(), /secret storage failure/)
    globalThis.__codocsCreationOssMode = 'missing'
    const repaired = await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'repair-key' }, body: JSON.stringify(body) })
    assert.equal(repaired.status, 200)

    globalThis.__codocsCreationOssMode = 'conflict'
    const beforeConflictPuts = ossCalls.filter(call => call.method === 'put').length
    const conflict = await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'conflict-key' }, body: JSON.stringify(body) })
    assert.equal(conflict.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeConflictPuts + 1)
    assert.equal(ossCalls.filter(call => call.method === 'head').at(-1).method, 'head')

    globalThis.__codocsCreationOssMode = 'conflict-missing'
    const beforeConflictMissingPuts = ossCalls.filter(call => call.method === 'put').length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'conflict-missing-key' }, body: JSON.stringify(body) })).status, 503)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeConflictMissingPuts + 1)

    globalThis.__codocsCreationSession = { ...session, authenticated: false }
    const beforeUnauthRuntime = runtimeCalls.length
    assert.equal((await fetch(`${base}/documents`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 401)
    assert.equal(runtimeCalls.length, beforeUnauthRuntime)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsCreationSession = oldSession
    globalThis.__codocsCreationAuthorization = oldAuth
    globalThis.__codocsCreationTransport = oldTransport
    globalThis.__codocsCreationPrepare = oldPrepare
    globalThis.__codocsCreationOss = oldOss
    globalThis.__codocsCreationOssMode = oldOssMode
    globalThis.__codocsCreationResponse = oldResponse
  }
})
