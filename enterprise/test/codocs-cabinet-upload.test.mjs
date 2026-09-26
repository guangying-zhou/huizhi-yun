import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs cabinet upload plans, stores and commits with idempotent facts', { timeout: 60000 }, async () => {
  const root = resolve(import.meta.dirname, '../..')
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const calls = []
  const ossCalls = []
  const objects = new Map()
  let authorization = { resources: { documents: ['create'] }, actionPolicies: {} }
  let mode = 'ok'
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__cabUploadSession', '__cabUploadAuth', '__cabUploadMode', '__cabUploadCalls', '__cabUploadOssCalls', '__cabUploadPrepareCount', '__cabUploadRevokeAfterPrepare', '__cabUploadCommitFailures', '__cabUploadCreateOss', '__cabUpload412Winner'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__cabUploadSession = session
  globalThis.__cabUploadAuth = () => authorization
  globalThis.__cabUploadMode = () => mode
  globalThis.__cabUploadCalls = calls
  globalThis.__cabUploadOssCalls = ossCalls
  globalThis.__cabUploadPrepareCount = 0
  globalThis.__cabUploadRevokeAfterPrepare = null
  globalThis.__cabUploadCommitFailures = 0
  globalThis.__cabUpload412Winner = false
  globalThis.__cabUploadCreateOss = async (options) => {
    ossCalls.push({ method: 'client', options })
    return {
    head: async (path) => {
      ossCalls.push({ method: 'head', path })
      if (!objects.has(path)) {
        const e = new Error('NoSuchKey')
        e.code = 'NoSuchKey'
        e.statusCode = 404
        throw e
      }
      const object = objects.get(path)
      return { meta: { 'hzy-content-sha256': object.sha }, res: { headers: { 'content-length': String(object.bytes.length) } } }
    },
    put: async (path, bytes, putOptions) => {
      calls.push({ kind: 'oss-put', path })
      ossCalls.push({ method: 'put', path, bytes, options: putOptions })
      if (mode === 'put-fails') throw Object.assign(new Error('secret storage'), { statusCode: 503 })
      if (mode === '409' || mode === '412') {
        if (mode === '409' || globalThis.__cabUpload412Winner) objects.set(path, { bytes: Buffer.from(bytes), sha: putOptions.meta['hzy-content-sha256'] })
        const e = new Error('already exists')
        e.statusCode = Number(mode)
        throw e
      }
      objects.set(path, { bytes: Buffer.from(bytes), sha: putOptions.meta['hzy-content-sha256'] })
      return { res: { headers: {} } }
    }
    }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__cabUploadSession'
      if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__cabUploadRevokeAfterPrepare===globalThis.__cabUploadPrepareCount?{resources:{},actionPolicies:{}}:globalThis.__cabUploadAuth()'
      if (specifier.endsWith('/tenantRuntimeClient')) source = `export const prepareTenantRuntime=async(...args)=>{globalThis.__cabUploadPrepareCount++;globalThis.__cabUploadCalls.push({kind:'prepare',event:args[0],options:args[1]});return true};export const maybeCallTenantRuntime=async(...args)=>{const [event,path,options]=args;globalThis.__cabUploadCalls.push({kind:'runtime',event,path,options});const current=globalThis.__cabUploadMode();if(['401','403','503'].includes(current)||(current==='commit-fail'&&path.endsWith('personal-cabinet:upload')&&globalThis.__cabUploadCommitFailures-->0)){const e=new Error('runtime secret');e.statusCode=Number(current==='commit-fail'?503:current);throw e}const payload=options.body.payload;const sha=payload?.content_sha256||'0'.repeat(64);const plan={uuid:'11111111-1111-4111-8111-111111111111',owner_uid:'person-a',original_name:payload?.original_name,file_ext:payload?.file_ext,file_size:payload?.file_size,content_sha256:sha,folder_id:payload?.folder_id??null,filename:payload?.original_name,oss_path:'codocs/users/person-a/cabinet/11111111-1111-4111-8111-111111111111/'+sha+'.'+payload?.file_ext,id:7};if(current==='bad-owner')plan.owner_uid='person-b';if(current==='bad-path')plan.oss_path='codocs/../unsafe';if(path.endsWith('upload-plan')){if(current==='revoke-after-plan')globalThis.__cabUploadRevokeAfterPrepare=globalThis.__cabUploadPrepareCount+1;return {handled:true,data:{success:true,data:plan}}}return {handled:true,data:{success:true,data:plan}}}`
      if (specifier.endsWith('/oss')) source = 'export const createRuntimeOSSClient=async options=>globalThis.__cabUploadCreateOss(options)'
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
    router.post('/codocs/api/cabinet/upload', (await import('../server/routes/codocs/api/cabinet/upload.post.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__cabUploadSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const upload = async (files, key = 'cabinet-upload-key', fields = { owner_uid: 'person-a' }, query = '') => {
      const form = new FormData()
      for (const [name, value] of Object.entries(fields)) form.append(name, value)
      for (const file of files) form.append('files', file)
      return fetch(`${base}/codocs/api/cabinet/upload${query}`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form })
    }
    const file = new File([Uint8Array.from([0, 1, 2, 255])], 'photo.png')
    let response = await upload([file])
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.success, 1, JSON.stringify(result))
    const planCall = calls.find(call => call.kind === 'runtime' && call.path.endsWith('upload-plan'))
    const commitCall = calls.find(call => call.kind === 'runtime' && call.path.endsWith('upload'))
    assert.ok(planCall && commitCall)
    assert.deepEqual(calls.filter(call => call.kind === 'runtime' || call.kind === 'oss-put').map(call => call.kind === 'oss-put' ? 'put' : call.path), [
      '/v1/enterprise/codocs/personal-cabinet:upload-plan', 'put', '/v1/enterprise/codocs/personal-cabinet:upload'
    ])
    assert.deepEqual(calls.filter(call => call.kind === 'runtime').slice(0, 2).map(call => call.path), [
      '/v1/enterprise/codocs/personal-cabinet:upload-plan',
      '/v1/enterprise/codocs/personal-cabinet:upload'
    ])
    const firstOssClient = ossCalls.find(call => call.method === 'client')
    assert.strictEqual(firstOssClient.options.event, planCall.event)
    assert.strictEqual(firstOssClient.options.event, commitCall.event)
    assert.equal(planCall.options.appCode, 'enterprise')
    assert.equal(planCall.options.scope, 'codocs:personal-cabinet:create')
    assert.equal(commitCall.options.scope, 'codocs:personal-cabinet:create')
    assert.equal(commitCall.options.body.payload.content_sha256, createHash('sha256').update(Buffer.from([0, 1, 2, 255])).digest('hex'))
    assert.equal(ossCalls.filter(call => call.method === 'put').length, 1)
    assert.deepEqual(ossCalls.find(call => call.method === 'put').bytes, Buffer.from([0, 1, 2, 255]))
    assert.equal(ossCalls.find(call => call.method === 'put').options.forbidOverwrite, true)
    assert.ok(planCall.options.body.authorization.expiresAt <= Date.now() + 15_000)
    assert.equal(commitCall.options.body.authorization.actorUid, 'person-a')

    const puts = ossCalls.filter(call => call.method === 'put').length
    response = await upload([file])
    assert.equal(response.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, puts, 'same key and facts reuse existing object')
    const firstPath = ossCalls.find(call => call.method === 'head')?.path
    objects.get(firstPath).sha = '0'.repeat(64)
    const beforeMismatchCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload')).length
    response = await upload([file])
    assert.equal((await response.json()).failed, 1, 'matching path with mismatched hash cannot commit')
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload')).length, beforeMismatchCommit)
    objects.get(firstPath).sha = createHash('sha256').update(Buffer.from([0, 1, 2, 255])).digest('hex')
    objects.get(firstPath).bytes = Buffer.from([0])
    response = await upload([file], 'length-mismatch-key')
    assert.equal((await response.json()).failed, 1, 'matching hash with mismatched length cannot commit')
    objects.get(firstPath).bytes = Buffer.from([0, 1, 2, 255])

    const changed = new File([Uint8Array.from([9, 8])], 'photo.png')
    response = await upload([changed], 'different-key')
    assert.equal(response.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, puts + 1)

    mode = 'put-fails'
    const beforeFailureCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload')).length
    response = await upload([new File(['failure'], 'failure.txt')], 'put-failure-key')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).failed, 1)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload')).length, beforeFailureCommit)
    mode = 'ok'

    mode = '409'
    response = await upload([new File(['conditional'], 'conditional.txt')], 'conditional-409-key')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).success, 1, '409 winner with matching HEAD can commit')
    mode = '412'
    const winnerBytes = Buffer.from('winner')
    globalThis.__cabUpload412Winner = true
    response = await upload([new File([winnerBytes], 'winner.txt')], 'conditional-412-key')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).success, 1, '412 winner with matching HEAD can commit')
    globalThis.__cabUpload412Winner = false
    mode = 'commit-fail'
    globalThis.__cabUploadCommitFailures = 1
    const retryFile = new File(['retry'], 'retry.txt')
    response = await upload([retryFile], 'commit-retry-key')
    assert.equal((await response.json()).failed, 1)
    const putsBeforeRetry = ossCalls.filter(call => call.method === 'put').length
    mode = 'ok'
    response = await upload([retryFile], 'commit-retry-key')
    assert.equal((await response.json()).success, 1)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, putsBeforeRetry, 'commit retry reuses existing object')
    mode = '412'
    response = await upload([new File(['missing'], 'missing.txt')], 'conditional-missing-key')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).failed, 1, 'conditional conflict without a winner cannot commit')
    mode = 'ok'

    mode = 'bad-owner'
    const beforeBadPlanOss = ossCalls.length
    assert.equal((await upload([new File(['x'], 'bad.txt')], 'bad-owner-key')).status, 200)
    assert.equal(ossCalls.length, beforeBadPlanOss)
    mode = 'bad-path'
    assert.equal((await upload([new File(['x'], 'badpath.txt')], 'bad-path-key')).status, 200)
    assert.equal(ossCalls.length, beforeBadPlanOss)
    mode = 'ok'

    authorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    assert.equal((await upload([new File(['x'], 'view.txt')], 'view-key')).status, 403)
    authorization = { resources: { documents: ['edit'] }, actionPolicies: {} }
    assert.equal((await upload([new File(['x'], 'edit.txt')], 'edit-key')).status, 403)
    authorization = { resources: { documents: ['create'] }, actionPolicies: {} }

    mode = 'ok'
    globalThis.__cabUploadRevokeAfterPrepare = globalThis.__cabUploadPrepareCount + 1
    const beforePrepareRevokeRuntime = calls.filter(call => call.kind === 'runtime').length
    const beforePrepareRevokeOss = ossCalls.length
    assert.equal((await upload([new File(['x'], 'prepare-revoke.txt')], 'prepare-revoke-key')).status, 403)
    assert.equal(calls.filter(call => call.kind === 'runtime').length, beforePrepareRevokeRuntime)
    assert.equal(ossCalls.length, beforePrepareRevokeOss)
    globalThis.__cabUploadRevokeAfterPrepare = null

    mode = 'revoke-after-plan'
    const beforeRevokeCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload')).length
    assert.equal((await upload([new File(['x'], 'revoke.txt')], 'revoke-key')).status, 403)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload')).length, beforeRevokeCommit)
    mode = 'ok'
    globalThis.__cabUploadRevokeAfterPrepare = null

    for (const code of ['401', '403', '503']) {
      mode = code
      const failedResponse = await upload([new File(['x'], `${code}.txt`)], `status-${code}-key`)
      assert.equal(failedResponse.status, Number(code) === 401 || Number(code) === 403 ? Number(code) : 200)
      if (code === '503') {
        const failedResult = await failedResponse.json()
        assert.equal(failedResult.failed, 1)
        assert.doesNotMatch(JSON.stringify(failedResult), /runtime secret/)
      }
    }
    mode = 'ok'
    assert.equal((await upload([new File(['x'], 'bad.txt')], 'query-key', { owner_uid: 'person-a' }, '?x=1')).status, 400)
    assert.equal((await upload([new File(['x'], 'bad.txt')], 'owner-key', { owner_uid: 'person-b' })).status, 403)
    assert.equal((await upload([new File(['x'], 'bad.txt')], 'duplicate-key', { owner_uid: 'person-a', folder_id: '1' })).status, 200)
    assert.equal((await upload([new File(['x'], 'missing-key.txt')], '')).status, 400)
    assert.equal((await upload([new File(['x'], 'short-key.txt')], 'short')).status, 400)
    const unknownFields = new FormData()
    unknownFields.append('owner_uid', 'person-a')
    unknownFields.append('unexpected', 'value')
    unknownFields.append('files', new File(['x'], 'unknown.txt'))
    assert.equal((await fetch(`${base}/codocs/api/cabinet/upload`, { method: 'POST', headers: { 'Idempotency-Key': 'unknown-field-key' }, body: unknownFields })).status, 400)
    const duplicateFields = new FormData()
    duplicateFields.append('owner_uid', 'person-a')
    duplicateFields.append('owner_uid', 'person-a')
    duplicateFields.append('files', new File(['x'], 'duplicate-field.txt'))
    assert.equal((await fetch(`${base}/codocs/api/cabinet/upload`, { method: 'POST', headers: { 'Idempotency-Key': 'duplicate-field-key' }, body: duplicateFields })).status, 400)
    globalThis.__cabUploadSession = { ...session, authenticated: false }
    assert.equal((await upload([new File(['x'], 'unauthenticated.txt')], 'unauthenticated-key')).status, 401)
    globalThis.__cabUploadSession = session
    const maximum = new File([new Uint8Array(100 * 1024 * 1024)], 'maximum.zip')
    response = await upload([maximum], 'maximum-size-key')
    assert.equal(response.status, 200)
    const maximumResult = await response.json()
    assert.equal(maximumResult.success, 1)
    assert.equal(maximumResult.failed, 0)
    const maximumCommit = calls.findLast(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:upload'))
    assert.equal(maximumCommit.options.body.payload.file_size, 100 * 1024 * 1024)
    const beforeTooLargeRuntime = calls.filter(call => call.kind === 'runtime').length
    const beforeTooLargeOss = ossCalls.length
    const tooLarge = new File([new Uint8Array(100 * 1024 * 1024 + 1)], 'too-large.zip')
    assert.equal((await upload([tooLarge], 'too-large-key')).status, 413)
    assert.equal(calls.filter(call => call.kind === 'runtime').length, beforeTooLargeRuntime)
    assert.equal(ossCalls.length, beforeTooLargeOss)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
