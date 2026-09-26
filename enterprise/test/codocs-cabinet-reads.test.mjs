import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs cabinet reads enforce scope, canonical metadata and event-aware storage', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const calls = []
  const ossCalls = []
  const files = {
    txt: { uuid: 'file-txt', owner_uid: 'person-a', oss_path: 'codocs/users/person-a/cabinet/file-txt.txt', original_name: 'notes.txt', file_ext: 'txt', file_size: 12 },
    pdf: { uuid: 'file-pdf', owner_uid: 'person-a', oss_path: 'codocs/users/person-a/cabinet/file-pdf.pdf', original_name: 'paper.pdf', file_ext: 'pdf', file_size: 12 },
    docx: { uuid: 'file-docx', owner_uid: 'person-a', oss_path: 'codocs/users/person-a/cabinet/file-docx.docx', original_name: 'word.docx', file_ext: 'docx', file_size: 12 },
    pptx: { uuid: 'file-pptx', owner_uid: 'person-a', oss_path: 'codocs/users/person-a/cabinet/file-pptx.pptx', original_name: 'slides.pptx', file_ext: 'pptx', file_size: 12 }
  }
  let auth = { resources: { documents: ['view', 'export'] }, actionPolicies: {} }
  let runtimeMode = 'ok'
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__codocsCabinetSession', '__codocsCabinetAuth', '__codocsCabinetRuntimeMode', '__codocsCabinetCalls', '__codocsCabinetOssCalls', '__codocsCabinetPrepareCount', '__codocsCabinetRevokeAfterPrepareCount', '__codocsCabinetFile'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsCabinetSession = session
  globalThis.__codocsCabinetAuth = () => auth
  globalThis.__codocsCabinetRuntimeMode = () => runtimeMode
  globalThis.__codocsCabinetCalls = calls
  globalThis.__codocsCabinetOssCalls = ossCalls
  globalThis.__codocsCabinetPrepareCount = 0
  globalThis.__codocsCabinetRevokeAfterPrepareCount = null

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = `export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsCabinetSession`
      if (specifier.endsWith('/tenantGatewayTrust')) source = `export const resolveTrustedTenantGatewayContext=()=>undefined`
      if (specifier.endsWith('/tenantRuntimeClient')) source = `export const prepareTenantRuntime=async(...args)=>{globalThis.__codocsCabinetPrepareCount++;globalThis.__codocsCabinetCalls.push({kind:'prepare',args});return true};export const maybeCallTenantRuntime=async(...args)=>{const [event,path,options]=args;globalThis.__codocsCabinetCalls.push({kind:'runtime',event,path,options});if(globalThis.__codocsCabinetRuntimeMode()==='error')throw Object.assign(new Error('runtime secret'),{statusCode:503});if(path.endsWith('personal-cabinet:list'))return {handled:true,data:{success:true,data:{items:[${JSON.stringify(files.txt)}],total:21,page:Number(options.body.query.page||1),pageSize:Number(options.body.query.pageSize||20)}}};if(path.endsWith('converted-info'))return {handled:true,data:{success:true,data:{doc_uuid:'doc-1',doc_title:'Converted',doc_path:'codocs/doc-1.md'}}};return {handled:true,data:{success:true,data:globalThis.__codocsCabinetFile||${JSON.stringify(files.txt)}}}}`
      if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>{if(globalThis.__codocsCabinetRevokeAfterPrepareCount===globalThis.__codocsCabinetPrepareCount)return {resources:{},actionPolicies:{}};return globalThis.__codocsCabinetAuth()}`
      if (specifier.endsWith('/oss')) source = `export const createRuntimeOSSClient=async(options)=>{globalThis.__codocsCabinetOssCalls.push({kind:'client',options});return {createSignedGetUrl:async(path,opts)=>{globalThis.__codocsCabinetOssCalls.push({kind:'signed',path,opts});return 'https://oss.test/'+path},get:async(path)=>{globalThis.__codocsCabinetOssCalls.push({kind:'get',path});if(globalThis.__codocsCabinetRuntimeMode()==='storage404'){const e=new Error('NoSuchKey');e.code='NoSuchKey';throw e}if(globalThis.__codocsCabinetRuntimeMode()==='storage503')throw new Error('secret storage');return {content:Buffer.from(path.endsWith('.pptx')?'pptx-bytes':'text-body')}}}}`
      if (specifier.endsWith('/officeConverter')) source = `export const docxToHtml=async()=>'<p>untrusted</p>'`
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
    router.get('/codocs/api/cabinet', (await import('../server/routes/codocs/api/cabinet/index.get.ts')).default)
    for (const [path, file] of [[':uuid/preview', '[uuid]/preview.get.ts'], [':uuid/preview-html', '[uuid]/preview-html.get.ts'], [':uuid/preview-pptx', '[uuid]/preview-pptx.get.ts'], [':uuid/download', '[uuid]/download.get.ts'], [':uuid/converted-info', '[uuid]/converted-info.get.ts']]) {
      router.get(`/codocs/api/cabinet/${path}`, (await import(`../server/routes/codocs/api/cabinet/${file}`)).default)
    }
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const get = path => fetch(base + path, { redirect: 'manual' })

    let response = await get('/codocs/api/cabinet?owner_uid=person-a&page=2&pageSize=20')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.total, 21)
    const listCall = calls.findLast(call => call.kind === 'runtime')
    const listPrepare = calls.find(call => call.kind === 'prepare')
    assert.equal(listPrepare.args[1].appCode, 'enterprise')
    assert.equal(listPrepare.args[1].scope, 'codocs:personal-cabinet:read')
    assert.equal(listCall.path, '/v1/enterprise/codocs/personal-cabinet:list')
    assert.equal(listCall.options.appCode, 'enterprise')
    assert.equal(listCall.options.scope, 'codocs:personal-cabinet:read')
    assert.equal(listCall.options.body.query.page, '2')
    assert.equal(listCall.options.body.authorization.actorUid, 'person-a')
    assert.equal(listCall.options.body.authorization.tenant, 'tenant-a')
    assert.equal(listCall.options.body.authorization.deployment, 'enterprise-test')
    assert.ok(listCall.options.body.authorization.expiresAt > Date.now())
    assert.ok(listCall.options.body.authorization.expiresAt - Date.now() <= 15000)

    for (const path of ['/codocs/api/cabinet?owner_uid=person-b', '/codocs/api/cabinet?page=1&page=2', '/codocs/api/cabinet?bad=1']) assert.equal((await get(path)).status, path.includes('person-b') ? 403 : 400)
    for (const path of ['/codocs/api/cabinet/file-txt/preview?x=1', '/codocs/api/cabinet/not valid/preview', '/codocs/api/cabinet/file-txt/download']) {
      if (path.endsWith('download')) continue
      assert.equal((await get(path)).status, 400)
    }

    globalThis.__codocsCabinetFile = files.txt
    response = await get('/codocs/api/cabinet/file-txt/preview')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.preview_type, 'text')
    assert.equal(ossCalls.findLast(call => call.kind === 'client').options.event.method, 'GET')

    globalThis.__codocsCabinetFile = files.pdf
    response = await get('/codocs/api/cabinet/file-pdf/preview')
    assert.equal((await response.json()).data.preview_url, 'https://oss.test/codocs/users/person-a/cabinet/file-pdf.pdf')
    globalThis.__codocsCabinetFile = files.docx
    response = await get('/codocs/api/cabinet/file-docx/preview')
    assert.match((await response.json()).data.preview_url, /^\/codocs\/api\/cabinet\/file-docx\/preview-html$/)
    globalThis.__codocsCabinetFile = files.pptx
    response = await get('/codocs/api/cabinet/file-pptx/preview')
    assert.match((await response.json()).data.preview_url, /^\/codocs\/api\/cabinet\/file-pptx\/preview-pptx$/)
    globalThis.__codocsCabinetFile = files.docx
    response = await get('/codocs/api/cabinet/file-docx/preview-html')
    assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    globalThis.__codocsCabinetFile = files.pptx
    response = await get('/codocs/api/cabinet/file-pptx/preview-pptx')
    assert.equal(await response.text(), 'pptx-bytes')

    globalThis.__codocsCabinetFile = files.txt
    response = await get('/codocs/api/cabinet/file-txt/download')
    assert.equal(response.status, 302)
    assert.equal(ossCalls.at(-1).kind, 'signed')
    assert.equal(ossCalls.at(-1).opts.response['content-disposition'].includes('notes.txt'), true)
    auth = { resources: { documents: ['view'] }, actionPolicies: {} }
    assert.equal((await get('/codocs/api/cabinet/file-txt/download')).status, 403)
    auth = { resources: { documents: ['export'] }, actionPolicies: {} }
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 403)

    auth = { resources: { documents: ['view', 'export'] }, actionPolicies: {} }
    globalThis.__codocsCabinetFile = { ...files.txt, owner_uid: 'person-b' }
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 503)
    globalThis.__codocsCabinetFile = { ...files.txt, dept_code: 'dep-a' }
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 503)
    globalThis.__codocsCabinetFile = files.txt
    const beforeConvertedOss = ossCalls.length
    assert.equal((await get('/codocs/api/cabinet/file-txt/converted-info')).status, 200)
    assert.equal(ossCalls.length, beforeConvertedOss)
    globalThis.__codocsCabinetFile = files.pptx
    runtimeMode = 'storage404'
    assert.equal((await get('/codocs/api/cabinet/file-pptx/preview-pptx')).status, 404)
    runtimeMode = 'storage503'
    const storageFailure = await get('/codocs/api/cabinet/file-pptx/preview-pptx')
    assert.equal(storageFailure.status, 503)
    assert.doesNotMatch(await storageFailure.text(), /secret storage/)
    runtimeMode = 'error'
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 503)

    runtimeMode = 'ok'
    globalThis.__codocsCabinetFile = files.txt
    globalThis.__codocsCabinetRevokeAfterPrepareCount = globalThis.__codocsCabinetPrepareCount + 1
    const beforeRevokeRuntime = calls.filter(call => call.kind === 'runtime').length
    const beforeRevokeOss = ossCalls.length
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 403)
    assert.equal(calls.filter(call => call.kind === 'runtime').length, beforeRevokeRuntime)
    assert.equal(ossCalls.length, beforeRevokeOss)
    globalThis.__codocsCabinetRevokeAfterPrepareCount = null

    globalThis.__codocsCabinetSession = { ...session, authenticated: false }
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 401)
    globalThis.__codocsCabinetSession = session

    globalThis.__codocsCabinetFile = { ...files.txt, project_code: 'project-a' }
    const beforeProjectOss = ossCalls.length
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 503)
    assert.equal(ossCalls.length, beforeProjectOss)
    globalThis.__codocsCabinetFile = { ...files.txt, oss_path: 'codocs/../unsafe.txt' }
    const beforePathOss = ossCalls.length
    assert.equal((await get('/codocs/api/cabinet/file-txt/preview')).status, 503)
    assert.equal(ossCalls.length, beforePathOss)
  } finally {
    hooks?.deregister?.()
    if (server) await new Promise(done => server.close(done))
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
