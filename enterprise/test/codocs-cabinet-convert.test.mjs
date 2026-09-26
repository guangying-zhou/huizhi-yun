import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

async function createDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello conversion</w:t></w:r></w:p></w:body></w:document>')
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

test('Enterprise Codocs cabinet conversion uses real DOCX conversion and fresh authorization', { timeout: 60000 }, async () => {
  const root = resolve(import.meta.dirname, '../..')
  const docx = await createDocx()
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const calls = []
  const ossCalls = []
  const timeline = []
  const objects = new Map()
  let mode = 'ok'
  let auth = { resources: { documents: ['view', 'create'] }, actionPolicies: {} }
  let sourceSize = docx.length
  let conditionalWinner = false
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__convertSession', '__convertAuth', '__convertMode', '__convertPrepareCount', '__convertRevokeAfter', '__convertCalls', '__convertTimeline', '__convertOss', '__convertSourceSize'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__convertSession = session
  globalThis.__convertAuth = () => auth
  globalThis.__convertMode = () => mode
  globalThis.__convertPrepareCount = 0
  globalThis.__convertRevokeAfter = null
  globalThis.__convertCalls = calls
  globalThis.__convertTimeline = timeline
  globalThis.__convertSourceSize = () => sourceSize
  globalThis.__convertOss = async (options) => {
    ossCalls.push({ method: 'client', options })
    return {
      get: async path => {
        ossCalls.push({ method: 'get', path })
        timeline.push({ kind: 'get', path })
        if (mode === 'storage404') throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey', statusCode: 404 })
        if (mode === 'storage503') throw Object.assign(new Error('secret storage'), { statusCode: 503 })
        if (mode === 'invalid-docx') return { content: Buffer.from('not a docx') }
        return { content: docx }
      },
      head: async path => {
        ossCalls.push({ method: 'head', path })
        timeline.push({ kind: 'head', path })
        if (!objects.has(path)) throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey', statusCode: 404 })
        const object = objects.get(path)
        return { meta: { 'hzy-content-sha256': object.sha }, res: { headers: { 'content-length': String(object.bytes.length) } } }
      },
      put: async (path, bytes, putOptions) => {
        ossCalls.push({ method: 'put', path, bytes, options: putOptions })
        timeline.push({ kind: 'put', path, bytes, options: putOptions })
        if (mode === 'put-fails') throw Object.assign(new Error('secret storage'), { statusCode: 503 })
        if (mode === 'put-409' || mode === 'put-412') {
          if (conditionalWinner) objects.set(path, { bytes: conditionalWinner === 'bad-size' ? Buffer.from('wrong length') : Buffer.from(bytes), sha: conditionalWinner === 'bad-hash' ? 'f'.repeat(64) : putOptions.meta['hzy-content-sha256'] })
          const error = new Error('already exists')
          error.statusCode = Number(mode.slice(4))
          throw error
        }
        objects.set(path, { bytes: Buffer.from(bytes), sha: putOptions.meta['hzy-content-sha256'] })
        return { res: { headers: {} } }
      }
    }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__convertSession'
      if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__convertRevokeAfter===globalThis.__convertPrepareCount?{resources:{},actionPolicies:{}}:globalThis.__convertAuth()'
      if (specifier.endsWith('/tenantRuntimeClient')) source = `export const prepareTenantRuntime=async(...args)=>{globalThis.__convertPrepareCount++;globalThis.__convertCalls.push({kind:'prepare',event:args[0],options:args[1]});globalThis.__convertTimeline.push({kind:'prepare'});return true};export const maybeCallTenantRuntime=async(...args)=>{const [event,path,options]=args;globalThis.__convertCalls.push({kind:'runtime',event,path,options});globalThis.__convertTimeline.push({kind:'runtime',path});const current=globalThis.__convertMode();if(['401','403'].includes(current)||(current==='commit-fail'&&path.endsWith('personal-cabinet:convert'))){const e=new Error('runtime failure');e.statusCode=Number(current==='commit-fail'?503:current);throw e}const payload=options.body.payload||{};const plan={uuid:'11111111-1111-4111-8111-111111111111',owner_uid:'person-a',title:options.body.payload?.title||'Converted',folder_id:options.body.payload?.folder_id??null,source_uuid:options.body.code,source_path:'codocs/users/person-a/cabinet/source.docx',source_ext:'docx',source_size:globalThis.__convertSourceSize(),source_state:'a'.repeat(64),target_prefix:'codocs/cabinet-conversions/11111111-1111-4111-8111-111111111111/'+'a'.repeat(64)+'/',replayed:false};if(current==='replay')return {handled:true,data:{success:true,data:{...plan,replayed:true,oss_path:plan.target_prefix+plan.source_state+'/'+ 'b'.repeat(64)+'.md'}}};if(current==='bad-owner')plan.owner_uid='person-b';if(current==='bad-state')plan.source_state='bad';if(current==='bad-prefix')plan.target_prefix='codocs/unsafe/';if(current==='bad-plan')plan.source_path='codocs/../unsafe';if(path.endsWith('conversion-plan')){if(current==='revoke-after-plan')globalThis.__convertRevokeAfter=globalThis.__convertPrepareCount+1;return {handled:true,data:{success:true,data:plan}}}const committed={...plan,oss_path:plan.target_prefix+plan.source_state+'/'+(payload.content_sha256||'b'.repeat(64))+'.md'};if(current==='bad-commit-path')committed.oss_path='codocs/../unsafe';return {handled:true,data:{success:true,data:committed}}}`
      if (specifier.endsWith('/oss')) source = 'export const createRuntimeOSSClient=async options=>globalThis.__convertOss(options)'
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
    router.post('/codocs/api/cabinet/:uuid/to-document', (await import('../server/routes/codocs/api/cabinet/[uuid]/to-document.post.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__convertSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = (url = '/codocs/api/cabinet/source-1/to-document', key = 'convert-key-1', body = { title: 'Converted', folder_id: null }) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })

    timeline.length = 0
    let response = await request()
    assert.equal(response.status, 200)
    const success = await response.json()
    assert.deepEqual(Object.keys(success.data).sort(), ['title', 'uuid'])
    const runtimeCalls = calls.filter(call => call.kind === 'runtime')
    assert.deepEqual(runtimeCalls.slice(0, 2).map(call => call.path), ['/v1/enterprise/codocs/personal-cabinet:conversion-plan', '/v1/enterprise/codocs/personal-cabinet:convert'])
    assert.equal(ossCalls.filter(call => call.method === 'get').length, 1)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, 1)
    assert.equal(ossCalls.find(call => call.method === 'client').options.event, runtimeCalls[0].event)
    const planIndex = timeline.findIndex(item => item.kind === 'runtime' && item.path.endsWith('conversion-plan'))
    const getIndex = timeline.findIndex(item => item.kind === 'get')
    const putIndex = timeline.findIndex(item => item.kind === 'put')
    const freshPrepareIndex = timeline.findIndex((item, index) => item.kind === 'prepare' && index > putIndex)
    const commitIndex = timeline.findIndex(item => item.kind === 'runtime' && item.path.endsWith('personal-cabinet:convert'))
    assert.ok(planIndex < getIndex && getIndex < putIndex && putIndex < freshPrepareIndex && freshPrepareIndex < commitIndex)
    const markdownPut = ossCalls.find(call => call.method === 'put')
    assert.match(markdownPut.bytes.toString('utf8'), /Hello conversion/)
    assert.equal(markdownPut.options.forbidOverwrite, true)
    assert.equal(markdownPut.options.headers['Content-Type'], 'text/markdown; charset=utf-8')
    assert.equal(markdownPut.options.meta['hzy-content-sha256'], createHash('sha256').update(markdownPut.bytes).digest('hex'))
    assert.equal(markdownPut.options.meta['hzy-content-sha256'].length, 64)
    assert.equal(runtimeCalls[1].options.body.payload.content_sha256, markdownPut.options.meta['hzy-content-sha256'])
    assert.equal(runtimeCalls[1].options.body.payload.content_size, markdownPut.bytes.length)
    assert.equal(runtimeCalls[1].options.body.payload.source_state, 'a'.repeat(64))
    assert.equal(runtimeCalls[1].options.idempotencyKey, 'convert-key-1')
    assert.deepEqual(runtimeCalls[1].options.body.authorization, { actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', resource: 'personal-cabinet', action: 'create', expiresAt: runtimeCalls[1].options.body.authorization.expiresAt })
    assert.equal(runtimeCalls[0].options.scope, 'codocs:personal-cabinet:create')
    assert.equal(runtimeCalls[1].options.scope, 'codocs:personal-cabinet:create')

    mode = 'replay'
    const beforeReplayOss = ossCalls.length
    response = await request('/codocs/api/cabinet/source-1/to-document', 'replay-key')
    assert.equal(response.status, 200)
    assert.equal(ossCalls.length, beforeReplayOss)
    mode = 'ok'

    mode = 'commit-fail'
    objects.clear()
    const beforeCommitFailCommits = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    response = await request('/codocs/api/cabinet/source-1/to-document', 'commit-retry-key')
    assert.equal(response.status, 503)
    const putsBeforeRetry = ossCalls.filter(call => call.method === 'put').length
    assert.equal(putsBeforeRetry > 1, true)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeCommitFailCommits + 1)
    mode = 'ok'
    response = await request('/codocs/api/cabinet/source-1/to-document', 'commit-retry-key')
    assert.equal(response.status, 200)
    assert.equal(ossCalls.filter(call => call.method === 'put').length, putsBeforeRetry)

    mode = 'put-fails'
    objects.clear()
    const beforePutFailCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'put-fails-key')).status, 503)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforePutFailCommit)
    mode = 'ok'

    const beforeStorage404Commit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    mode = 'storage404'
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'storage-404-key')).status, 404)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeStorage404Commit)
    const beforeStorage503Commit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    mode = 'storage503'
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'storage-503-key')).status, 503)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeStorage503Commit)
    const beforeInvalidDocxCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    mode = 'invalid-docx'
    sourceSize = Buffer.from('not a docx').length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'invalid-docx-key')).status, 422)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeInvalidDocxCommit)
    mode = 'ok'
    sourceSize = docx.length
    sourceSize++
    const beforeChangedCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'source-changed-key')).status, 409)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeChangedCommit)
    sourceSize = docx.length

    objects.clear()
    conditionalWinner = true
    mode = 'put-409'
    const before409Commit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'put-409-key')).status, 200)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, before409Commit + 1)
    objects.clear()
    mode = 'put-412'
    const before412Commit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'put-412-key')).status, 200)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, before412Commit + 1)
    conditionalWinner = false
    objects.clear()
    mode = 'put-409'
    const beforeBadWinnerCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'put-409-missing-key')).status, 503)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeBadWinnerCommit)
    for (const mismatch of ['bad-hash', 'bad-size']) {
      for (const conflictMode of ['put-409', 'put-412']) {
        objects.clear()
        conditionalWinner = mismatch
        mode = conflictMode
        const commits = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
        assert.equal((await request('/codocs/api/cabinet/source-1/to-document', `${conflictMode}-${mismatch}-key`)).status, 409)
        assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, commits)
      }
    }
    conditionalWinner = false
    mode = 'ok'

    // An existing target with a stale digest/length must not be treated as a replay.
    objects.clear()
    await request('/codocs/api/cabinet/source-1/to-document', 'seed-existing-key')
    const existingPath = [...objects.keys()][0]
    objects.get(existingPath).sha = 'b'.repeat(64)
    const beforeExistingMismatchCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'existing-mismatch-key')).status, 409)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeExistingMismatchCommit)
    objects.get(existingPath).sha = createHash('sha256').update(markdownPut.bytes).digest('hex')
    objects.get(existingPath).bytes = Buffer.from('wrong size')
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'existing-size-key')).status, 409)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeExistingMismatchCommit)

    mode = 'bad-plan'
    const beforeBadPlanOss = ossCalls.length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'bad-plan-key')).status, 503)
    assert.equal(ossCalls.length, beforeBadPlanOss)
    for (const invalidMode of ['bad-owner', 'bad-state', 'bad-prefix']) {
      mode = invalidMode
      const beforeInvalidPlanOss = ossCalls.length
      assert.equal((await request('/codocs/api/cabinet/source-1/to-document', `${invalidMode}-key`)).status, 503)
      assert.equal(ossCalls.length, beforeInvalidPlanOss)
    }
    mode = 'bad-commit-path'
    objects.clear()
    const beforeCommitPathOss = ossCalls.length
    const beforeCommitPathCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'bad-commit-path-key')).status, 503)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeCommitPathCommit + 1)
    assert.ok(ossCalls.length > beforeCommitPathOss)
    mode = 'ok'
    auth = { resources: { documents: ['view'] }, actionPolicies: {} }
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'view-only-key')).status, 403)
    auth = { resources: { documents: ['create'] }, actionPolicies: {} }
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'create-only-key')).status, 403)
    auth = { resources: { documents: ['view', 'create'] }, actionPolicies: {} }
    mode = 'revoke-after-plan'
    const beforeRevokeCommit = calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'revoke-key')).status, 403)
    assert.equal(calls.filter(call => call.kind === 'runtime' && call.path.endsWith('personal-cabinet:convert')).length, beforeRevokeCommit)
    mode = 'ok'
    globalThis.__convertRevokeAfter = null
    for (const code of [401, 403]) { mode = String(code); assert.equal((await request('/codocs/api/cabinet/source-1/to-document', `status-${code}-key`)).status, code) }
    mode = 'ok'
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document?x=1', 'query-key')).status, 400)
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'short')).status, 400)
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'body-key', { title: 'x', extra: true })).status, 400)
    globalThis.__convertSession = { ...session, authenticated: false }
    assert.equal((await request('/codocs/api/cabinet/source-1/to-document', 'unauth-key')).status, 401)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
