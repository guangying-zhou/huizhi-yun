import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs multipart upload preserves per-file idempotency, audit, and failure isolation', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const runtimeCalls = []
  const runtimeResults = new Map()
  const ossCalls = []
  const audits = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__codocsUploadSession', '__codocsUploadAuthorization', '__codocsUploadPrepare', '__codocsUploadTransport', '__codocsUploadOss', '__codocsUploadAudit', '__codocsUploadExisting', '__codocsUploadFailNext', '__codocsUploadTransportError'].map(k => [k, globalThis[k]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsUploadSession = session
  globalThis.__codocsUploadAuthorization = { resources: { documents: ['create'] }, actionPolicies: {} }
  globalThis.__codocsUploadPrepare = async () => true
  globalThis.__codocsUploadAudit = (...args) => { audits.push({ payload: args[0], options: args[1] }); return Promise.resolve() }
  globalThis.__codocsUploadTransport = async (_event, path, options) => {
    runtimeCalls.push({ path, options })
    if (globalThis.__codocsUploadTransportError) throw globalThis.__codocsUploadTransportError
    const title = options.body.payload.title
    const itemKey = options.idempotencyKey
    const uuid = runtimeResults.get(itemKey) || `123e4567-e89b-12d3-a456-42661417400${String(runtimeResults.size + 1)}`
    runtimeResults.set(itemKey, uuid)
    return { handled: true, data: { success: true, data: { id: runtimeCalls.length, uuid, title, doc_type: options.body.payload.doc_type, oss_path: `codocs/document-creations/${uuid}/${'a'.repeat(64)}.md` } } }
  }
  globalThis.__codocsUploadOss = async () => ({
    async head(path) {
      ossCalls.push({ method: 'head', path })
      if (globalThis.__codocsUploadExisting?.has(path)) return { etag: 'existing' }
      const error = new Error('NoSuchKey'); error.code = 'NoSuchKey'; throw error
    },
    async put(path, bytes, options) {
      ossCalls.push({ method: 'put', path, bytes, options })
      if (globalThis.__codocsUploadFailNext) { globalThis.__codocsUploadFailNext = false; throw new Error('storage down') }
      globalThis.__codocsUploadExisting ||= new Set()
      globalThis.__codocsUploadExisting.add(path)
      return { etag: 'created' }
    }
  })

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsUploadSession'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsUploadAuthorization'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsUploadPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsUploadTransport(...args)'
      if (specifier.endsWith('/oss')) source = 'export const createRuntimeOSSClient=async(...args)=>globalThis.__codocsUploadOss(...args)'
      if (specifier.endsWith('/accountApi')) source = 'export const reportOperationAudit=(...args)=>globalThis.__codocsUploadAudit(...args)'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  const upload = async (base, files, headers = {}) => {
    const form = new FormData()
    for (const [name, value] of headers.fieldEntries || Object.entries(headers.fields || {})) form.append(name, value)
    for (const file of files) form.append('files', new Blob([file.data], { type: 'text/markdown' }), file.name)
    const requestHeaders = {}
    if (Object.hasOwn(headers, 'key') ? headers.key : true) requestHeaders['Idempotency-Key'] = Object.hasOwn(headers, 'key') ? headers.key : 'upload-key-1'
    return fetch(`${base}/upload${headers.query || ''}`, { method: 'POST', headers: requestHeaders, body: form })
  }

  let server
  try {
    const app = createApp()
    const router = createRouter()
    router.post('/upload', (await import('../server/routes/codocs/api/documents/upload.post.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsUploadSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    let response = await upload(base, [{ name: 'one.md', data: '# one' }, { name: 'two.md', data: '# two' }], { key: 'batch-key-1', fields: { doc_type: 'slide', folder_id: '7' } })
    assert.equal(response.status, 200)
    const first = await response.json()
    assert.equal(first.success, 2, JSON.stringify(first))
    assert.equal(first.failed, 0)
    assert.equal(runtimeCalls.length, 2)
    assert.equal(new Set(runtimeCalls.map(call => call.options.idempotencyKey)).size, 2)
    assert.equal(audits.length, 2)
    assert.ok(audits.every(audit => audit.payload.operatorUid === 'person-a' && audit.payload.action === 'codocs.document.upload'))
    assert.equal(audits[0].payload.sourceApp, 'enterprise')
    assert.equal(audits[0].options.idempotencyKey, `${runtimeCalls[0].options.idempotencyKey}:audit`)
    assert.equal(ossCalls.find(call => call.method === 'put').options.forbidOverwrite, true)
    assert.deepEqual([...ossCalls.find(call => call.method === 'put').bytes], [...Buffer.from('# one')])
    const putsAfterFirst = ossCalls.filter(call => call.method === 'put').length
    globalThis.__codocsUploadExisting = new Set(ossCalls.filter(call => call.method === 'put').map(call => call.path))
    response = await upload(base, [{ name: 'one.md', data: '# one' }, { name: 'two.md', data: '# two' }], { key: 'batch-key-1', fields: { doc_type: 'slide', folder_id: '7' } })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).success, 2)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, putsAfterFirst)
    assert.deepEqual(runtimeCalls.slice(0, 2).map(call => call.options.idempotencyKey), runtimeCalls.slice(2, 4).map(call => call.options.idempotencyKey))
    assert.deepEqual(audits.slice(0, 2).map(audit => audit.options.idempotencyKey), audits.slice(2, 4).map(audit => audit.options.idempotencyKey))

    globalThis.__codocsUploadFailNext = true
    const auditsBeforePartial = audits.length
    response = await upload(base, [{ name: 'fail.md', data: '# fail' }, { name: 'ok.md', data: '# ok' }], { key: 'partial-key-1' })
    assert.equal(response.status, 200)
    const partial = await response.json()
    assert.equal(partial.success, 1)
    assert.equal(partial.failed, 1)
    assert.equal(audits.length, auditsBeforePartial + 1)
    response = await upload(base, [{ name: 'fail.md', data: '# fail' }, { name: 'ok.md', data: '# ok' }], { key: 'partial-key-1' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).success, 2)

    const beforeInvalid = runtimeCalls.length
    for (const file of [{ name: 'bad.txt', data: 'x' }, { name: '../bad.md', data: 'x' }, { name: 'bad.md', data: Buffer.from([0xff, 0xfe]) }]) {
      response = await upload(base, [file], { key: `invalid-${beforeInvalid}-${file.name.replace(/\W/g, '')}` })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).failed, 1)
    }
    assert.equal(runtimeCalls.length, beforeInvalid)

    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'extra-key-1', fields: { owner_uid: 'other' } })
    assert.equal(response.status, 403)
    assert.equal(runtimeCalls.length, beforeInvalid)
    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'dup-field-1', fields: { doc_type: 'private' } })
    assert.equal(response.status, 200)
    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'duplicate-field-1', fieldEntries: [['doc_type', 'private'], ['doc_type', 'slide']] })
    assert.equal(response.status, 400)
    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'query-key-1', query: '?owner_uid=spoof' })
    assert.equal(response.status, 400)

    globalThis.__codocsUploadAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    const deniedRuntime = runtimeCalls.length
    const deniedOss = ossCalls.length
    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'denied-key-1' })
    assert.equal(response.status, 403)
    assert.equal(runtimeCalls.length, deniedRuntime)
    assert.equal(ossCalls.length, deniedOss)
    globalThis.__codocsUploadAuthorization = { resources: { documents: ['create'] }, actionPolicies: {} }
    globalThis.__codocsUploadTransportError = Object.assign(new Error('runtime forbidden'), { statusCode: 403 })
    const forbiddenAudits = audits.length
    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'runtime-403-1' })
    assert.equal(response.status, 403)
    assert.equal(audits.length, forbiddenAudits)
    delete globalThis.__codocsUploadTransportError
    globalThis.__codocsUploadSession = { ...session, authenticated: false }
    const unauthRuntime = runtimeCalls.length
    const unauthOss = ossCalls.length
    response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: 'unauth-key-1' })
    assert.equal(response.status, 401)
    assert.equal(runtimeCalls.length, unauthRuntime)
    assert.equal(ossCalls.length, unauthOss)
    globalThis.__codocsUploadSession = session

    for (const key of [undefined, 'short', 'has space-key']) {
      response = await upload(base, [{ name: 'x.md', data: 'x' }], { key })
      assert.equal(response.status, 400)
    }
    for (const fields of [{ folder_id: '0' }, { folder_id: '1.5' }, { extra: 'x' }]) {
      response = await upload(base, [{ name: 'x.md', data: 'x' }], { key: `bad-field-${Math.random()}`, fields })
      assert.equal(response.status, 400)
    }

    response = await upload(base, [{ name: 'large.md', data: 'x'.repeat(10 * 1024 * 1024 + 1) }], { key: 'large-key-1' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).failed, 1)
    response = await upload(base, Array.from({ length: 31 }, (_, i) => ({ name: `${i}.md`, data: 'x' })), { key: 'too-many-1' })
    assert.equal(response.status, 413)
    const chunk = 'x'.repeat(7.5 * 1024 * 1024 + 1)
    response = await upload(base, [1, 2, 3, 4].map(i => ({ name: `batch-${i}.md`, data: chunk })), { key: 'too-large-batch-1' })
    assert.equal(response.status, 413)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) globalThis[key] = value
  }
})
