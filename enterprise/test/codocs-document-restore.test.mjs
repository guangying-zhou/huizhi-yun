import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs restore validates the Runtime plan and copies legacy objects before commit', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const runtimeCalls = []
  const preparations = []
  const ossCalls = []
  const objects = new Map()
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const hash = 'a'.repeat(64)
  const uuid = 'doc-restore'
  const stablePlan = { uuid, title: 'Restored', doc_type: 'private', source_path: 'codocs/document-creations/doc-restore/body.md', target_path: 'codocs/document-creations/doc-restore/body.md', state_sha256: hash, deleted: true }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsRestoreSession
  const oldAuth = globalThis.__codocsRestoreAuthorization
  const oldPrepare = globalThis.__codocsRestorePrepare
  const oldTransport = globalThis.__codocsRestoreTransport
  const oldOss = globalThis.__codocsRestoreOss
  const oldPlan = globalThis.__codocsRestorePlan
  const oldOssMode = globalThis.__codocsRestoreOssMode
  const oldRevoke = globalThis.__codocsRestoreRevokeOnCommit
  const oldCommitError = globalThis.__codocsRestoreCommitError
  const oldPutConflict = globalThis.__codocsRestorePutConflict
  const oldPrepareCount = globalThis.__codocsRestorePrepareCount
  const oldRevokeAfterPrepareCount = globalThis.__codocsRestoreRevokeAfterPrepareCount

  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsRestoreSession = session
  globalThis.__codocsRestoreAuthorization = { resources: { documents: ['edit'] }, actionPolicies: {} }
  globalThis.__codocsRestorePlan = { success: true, data: stablePlan }
  globalThis.__codocsRestoreOssMode = 'stable'
  globalThis.__codocsRestoreRevokeOnCommit = false
  globalThis.__codocsRestorePrepare = async (_event, options) => { preparations.push(options); globalThis.__codocsRestorePrepareCount = preparations.length; return true }
  globalThis.__codocsRestoreTransport = async (_event, path, options) => {
    runtimeCalls.push({ path, options })
    if (path.endsWith('restore-plan')) return { handled: true, data: globalThis.__codocsRestorePlan }
    if (globalThis.__codocsRestoreCommitError) throw globalThis.__codocsRestoreCommitError
    return { handled: true, data: { success: true, data: { uuid, restored: true } } }
  }
  globalThis.__codocsRestoreOss = async options => {
    const mode = globalThis.__codocsRestoreOssMode
    return {
      async head(path) {
        ossCalls.push({ method: 'head', path, options })
        if (objects.has(path)) return { etag: 'persisted' }
        if (mode === 'stable' && path === stablePlan.source_path) return { etag: 'stable' }
        if ((mode === 'legacy' || mode === 'put-conflict') && path.startsWith('recycle.bin/')) return { etag: 'source' }
        if ((mode === 'legacy' || mode === 'put-conflict' || mode === 'put-conflict-missing' || mode === 'yjs-race') && path.startsWith('codocs/document-restores/')) {
          const error = new Error('NoSuchKey'); error.code = 'NoSuchKey'; error.statusCode = 404; throw error
        }
        if (mode === 'missing' || mode === 'put-fails' || mode === 'put-conflict-missing') {
          const error = new Error('NoSuchKey'); error.code = 'NoSuchKey'; throw error
        }
        return { etag: 'copied' }
      },
      async get(path) {
        ossCalls.push({ method: 'get', path, options })
        if (mode === 'missing') { const error = new Error('NoSuchKey'); error.code = 'NoSuchKey'; error.statusCode = 404; throw error }
        return { content: Buffer.from(path.endsWith('.yjs') ? 'yjs-state' : '# markdown') }
      },
      async put(path, content, putOptions) {
        ossCalls.push({ method: 'put', path, content, options: putOptions })
        if (mode === 'put-fails') throw new Error('secret storage write failure')
        if (mode === 'put-conflict' || mode === 'put-conflict-missing' || mode === 'yjs-race') {
          if (mode === 'put-conflict') objects.set(path, content)
          const error = new Error('already exists')
          error.statusCode = globalThis.__codocsRestorePutConflict || 409
          throw error
        }
        objects.set(path, content)
        return { etag: 'copied' }
      }
    }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/oss')) source = 'export const createRuntimeOSSClient=async(...args)=>globalThis.__codocsRestoreOss(...args)'
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsRestoreSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsRestorePrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsRestoreTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>{if(globalThis.__codocsRestoreRevokeAfterPrepareCount===globalThis.__codocsRestorePrepareCount){globalThis.__codocsRestoreAuthorization={resources:{},actionPolicies:{}}}return globalThis.__codocsRestoreAuthorization}'
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
    router.post('/documents/:uuid/restore', (await import('../server/routes/codocs/api/documents/[uuid]/restore.post.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsRestoreSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const body = JSON.stringify({ new_title: 'Restored' })
    const request = (path = `/documents/${uuid}/restore`, key = 'restore-key-1', requestBody = body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: requestBody })

    globalThis.__codocsRestoreRevokeAfterPrepareCount = preparations.length + 1
    const beforePlanRevokeRuntime = runtimeCalls.length
    const beforePlanRevokeOss = ossCalls.length
    assert.equal((await request('/documents/doc-restore/restore', 'plan-revoked-key')).status, 403)
    assert.equal(runtimeCalls.length, beforePlanRevokeRuntime)
    assert.equal(ossCalls.length, beforePlanRevokeOss)
    globalThis.__codocsRestoreRevokeAfterPrepareCount = null
    globalThis.__codocsRestoreAuthorization = { resources: { documents: ['edit'] }, actionPolicies: {} }

    const stable = await request()
    assert.equal(stable.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, 0)
    assert.equal(ossCalls.filter(call => call.method === 'head').length, 2)
    assert.equal(runtimeCalls[0].path, '/v1/enterprise/codocs/personal-documents:restore-plan')
    assert.equal(runtimeCalls[0].options.scope, 'codocs:personal-documents:edit')
    assert.equal(runtimeCalls[0].options.body.code, uuid)
    assert.equal(runtimeCalls[0].options.body.authorization.actorUid, 'person-a')
    assert.equal(runtimeCalls[0].options.body.authorization.tenant, 'tenant-a')
    assert.equal(runtimeCalls[0].options.body.authorization.deployment, 'enterprise-test')
    assert.equal(runtimeCalls[0].options.body.authorization.action, 'edit')
    assert.ok(runtimeCalls[0].options.body.authorization.expiresAt > Date.now())
    assert.equal(runtimeCalls[0].options.idempotencyKey, 'restore-key-1')
    assert.equal(runtimeCalls.at(-1).path, '/v1/enterprise/codocs/personal-documents:restore')
    assert.equal(preparations[0].scope, 'codocs:personal-documents:edit')
    assert.equal(preparations.length, 3)

    globalThis.__codocsRestoreOssMode = 'legacy'
    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, source_path: 'recycle.bin/document-creations/doc-restore/body.md', target_path: `codocs/document-restores/${uuid}/${hash}.md` } }
    ossCalls.length = 0
    const legacy = await request('/documents/doc-restore/restore', 'legacy-key')
    assert.equal(legacy.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, 2)
    assert.equal(ossCalls.filter(call => call.method === 'put').every(call => call.options.forbidOverwrite === true), true)
    assert.equal(ossCalls.some(call => call.method === 'get' && call.path.endsWith('.yjs')), true)
    assert.equal(ossCalls.some(call => call.method === 'delete'), false)

    globalThis.__codocsRestoreOssMode = 'missing'
    const missingHash = 'c'.repeat(64)
    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, state_sha256: missingHash, source_path: 'recycle.bin/missing.md', target_path: `codocs/document-restores/${uuid}/${missingHash}.md` } }
    const beforeMissingCommit = runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length
    assert.equal((await request('/documents/doc-restore/restore', 'missing-key')).status, 404)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length, beforeMissingCommit)

    globalThis.__codocsRestoreOssMode = 'put-fails'
    const beforePutFailureCommit = runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length
    const putFailure = await request('/documents/doc-restore/restore', 'put-failure-key')
    assert.equal(putFailure.status, 503)
    assert.doesNotMatch(await putFailure.text(), /secret storage write failure/)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length, beforePutFailureCommit)

    globalThis.__codocsRestoreOssMode = 'legacy'
    const retryHash = 'b'.repeat(64)
    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, source_path: 'recycle.bin/document-creations/doc-restore/retry.md', target_path: `codocs/document-restores/${uuid}/${retryHash}.md`, state_sha256: retryHash } }
    globalThis.__codocsRestoreCommitError = Object.assign(new Error('commit conflict'), { statusCode: 409 })
    const beforeRetryPuts = ossCalls.filter(call => call.method === 'put').length
    assert.equal((await request('/documents/doc-restore/restore', 'commit-retry-key')).status, 409)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeRetryPuts + 2)
    globalThis.__codocsRestoreCommitError = null
    assert.equal((await request('/documents/doc-restore/restore', 'commit-retry-key')).status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeRetryPuts + 2)

    globalThis.__codocsRestoreRevokeAfterPrepareCount = preparations.length + 2
    const beforeRevokedPlan = runtimeCalls.filter(call => call.path.endsWith('restore-plan')).length
    const beforeRevokedCommit = runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length
    assert.equal((await request('/documents/doc-restore/restore', 'revoked-key')).status, 403)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('restore-plan')).length, beforeRevokedPlan + 1)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length, beforeRevokedCommit)
    globalThis.__codocsRestoreRevokeAfterPrepareCount = null
    globalThis.__codocsRestoreAuthorization = { resources: { documents: ['edit'] }, actionPolicies: {} }

    for (const [path, key, requestBody] of [
      ['/documents/doc-restore/restore?query=1', 'bad-query-key', body],
      ['/documents/doc-restore/restore', 'short', body],
      ['/documents/doc-restore/restore', 'bad-body-key', JSON.stringify({ owner_uid: 'person-b', oss_path: 'recycle.bin/evil.md' })]
    ]) assert.equal((await request(path, key, requestBody)).status, 400)

    globalThis.__codocsRestoreOssMode = 'put-conflict'
    globalThis.__codocsRestorePutConflict = 412
    const conditionalHash = 'd'.repeat(64)
    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, state_sha256: conditionalHash, source_path: 'recycle.bin/document-creations/doc-restore/conditional.md', target_path: `codocs/document-restores/${uuid}/${conditionalHash}.md` } }
    const beforeConditionalPuts = ossCalls.filter(call => call.method === 'put').length
    assert.equal((await request('/documents/doc-restore/restore', 'conditional-key')).status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, beforeConditionalPuts + 2)
    globalThis.__codocsRestoreOssMode = 'put-conflict-missing'
    const missingWinnerHash = 'e'.repeat(64)
    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, state_sha256: missingWinnerHash, source_path: 'recycle.bin/document-creations/doc-restore/conditional-missing.md', target_path: `codocs/document-restores/${uuid}/${missingWinnerHash}.md` } }
    const beforeMissingWinnerCommit = runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length
    assert.equal((await request('/documents/doc-restore/restore', 'conditional-missing-key')).status, 503)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length, beforeMissingWinnerCommit)
    globalThis.__codocsRestorePutConflict = null

    const raceHash = 'f'.repeat(64)
    const raceTarget = `codocs/document-restores/${uuid}/${raceHash}.md`
    objects.set(raceTarget, Buffer.from('# already restored'))
    globalThis.__codocsRestoreOssMode = 'yjs-race'
    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, state_sha256: raceHash, source_path: 'recycle.bin/document-creations/doc-restore/race.md', target_path: raceTarget } }
    const beforeRaceCommit = runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length
    assert.equal((await request('/documents/doc-restore/restore', 'yjs-race-key')).status, 503)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:restore')).length, beforeRaceCommit)

    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, target_path: 'codocs/../unsafe.md' } }
    const beforeUnsafePlanOss = ossCalls.length
    assert.equal((await request('/documents/doc-restore/restore', 'unsafe-plan-key')).status, 503)
    assert.equal(ossCalls.length, beforeUnsafePlanOss)

    for (const permission of ['view', 'delete']) {
      globalThis.__codocsRestoreAuthorization = { resources: { documents: [permission] }, actionPolicies: {} }
      const beforeNoEdit = runtimeCalls.length
      assert.equal((await request('/documents/doc-restore/restore', `no-edit-${permission}-key`)).status, 403)
      assert.equal(runtimeCalls.length, beforeNoEdit)
    }
    globalThis.__codocsRestoreAuthorization = { resources: { documents: ['edit'] }, actionPolicies: {} }

    globalThis.__codocsRestoreSession = { ...session, authenticated: false }
    const beforeUnauthenticated = runtimeCalls.length
    assert.equal((await request('/documents/doc-restore/restore', 'unauthenticated-key')).status, 401)
    assert.equal(runtimeCalls.length, beforeUnauthenticated)
    globalThis.__codocsRestoreSession = session

    globalThis.__codocsRestorePlan = { success: true, data: { ...stablePlan, uuid: 'other-doc' } }
    const beforeInvalidPlanOss = ossCalls.length
    assert.equal((await request('/documents/doc-restore/restore', 'invalid-plan-key')).status, 503)
    assert.equal(ossCalls.length, beforeInvalidPlanOss)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsRestoreSession = oldSession
    globalThis.__codocsRestoreAuthorization = oldAuth
    globalThis.__codocsRestorePrepare = oldPrepare
    globalThis.__codocsRestoreTransport = oldTransport
    globalThis.__codocsRestoreOss = oldOss
    globalThis.__codocsRestorePlan = oldPlan
    globalThis.__codocsRestoreOssMode = oldOssMode
    globalThis.__codocsRestoreRevokeOnCommit = oldRevoke
    globalThis.__codocsRestoreCommitError = oldCommitError
    globalThis.__codocsRestorePutConflict = oldPutConflict
    globalThis.__codocsRestorePrepareCount = oldPrepareCount
    globalThis.__codocsRestoreRevokeAfterPrepareCount = oldRevokeAfterPrepareCount
  }
})
