import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createApp, createRouter, toNodeListener } from 'h3'

test('department assets require current R, exact path, record before preview, and short links recheck access', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { resources: { departments: ['view', 'export', 'admin'] }, role: 'member', directoryDown: false,
    recordDown: false, calls: [], metadata: new Map(), objects: new Map([['codocs/departments/D1/records/a.md', Buffer.from('department secret')], ['codocs/departments/D1/outsides/a.md', Buffer.from('# public notice')]]) }
  const oldState = globalThis.__departmentAssetsState, oldDefine = globalThis.defineEventHandler
  globalThis.__departmentAssetsState = state
  globalThis.defineEventHandler = value => value
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'reader',tenant:'C000001',deployment:'C000001-test-enterprise'})
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000
      export const prepareEnterpriseRuntime=async()=>{}
      export const callEnterpriseRuntime=async(_event,operation,input)=>{const s=globalThis.__departmentAssetsState;s.calls.push({operation,input});
        if(operation==='console.directory-self-accessible-departments')return {data:[{deptCode:'D1',name:'Department 1'}]};
        if(operation==='codocs.department-access-resolve'){if(s.directoryDown)throw Object.assign(new Error('down'),{statusCode:503});return {success:true,data:{role:s.role,canRead:s.role!=='none'}};}
        if(operation==='codocs.company-asset-record-access'){if(s.recordDown)throw Object.assign(new Error('down'),{statusCode:503});return {success:true,data:{recorded:true,id:input.payload.eventId}};}
        if(operation.startsWith('codocs.company-asset-archive-'))return {success:true,data:{operationId:input.payload.operationId,action:'archive',phase:operation.endsWith('prepare')?'prepare':'complete'}};
        if(operation==='codocs.review-history-by-oss-path')return {success:true,data:{extra:{outsideFileLevel:'general'}}};
        if(operation==='codocs.published-asset-links-create')return {success:true,data:{token:'1234567890abcdef',path:input.payload.path}};
        if(operation==='codocs.published-asset-links-resolve')return {success:true,data:{token:'1234567890abcdef',path:'codocs/departments/D1/records/a.md'}};
        throw Error(operation)}
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__departmentAssetsState.resources,actionPolicies:{}})`
    if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true`
    if (specifier.endsWith('/oss')) source = `export const createRuntimeOSSClient=async()=>({
      listV2:async({prefix})=>({prefixes:[],objects:[...globalThis.__departmentAssetsState.objects].filter(([path])=>path.startsWith(prefix)).map(([name,content])=>({name,size:content.length,lastModified:'2026-09-29'})),isTruncated:false}),
      get:async path=>{const content=globalThis.__departmentAssetsState.objects.get(path);if(!content)throw Object.assign(Error('missing'),{status:404});return {content,res:{headers:{etag:'etag'}}}},
      head:async path=>{if(!globalThis.__departmentAssetsState.objects.has(path))throw Object.assign(Error('missing'),{status:404});return {meta:globalThis.__departmentAssetsState.metadata.get(path)||{},res:{headers:{etag:'etag','content-length':String(globalThis.__departmentAssetsState.objects.get(path).length)}}}},
      put:async(path,content,options)=>{if(globalThis.__departmentAssetsState.objects.has(path))throw Object.assign(Error('exists'),{status:409});globalThis.__departmentAssetsState.objects.set(path,content);globalThis.__departmentAssetsState.metadata.set(path,options.meta)},
      delete:async path=>{globalThis.__departmentAssetsState.objects.delete(path)}
    })`
    if (specifier.endsWith('/markdownToDocx')) source = `export const markdownToDocx=async()=>Buffer.from('docx')`
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
    router.get('/list', (await import('../server/routes/codocs/api/dept-assets/list.get.ts')).default)
    router.get('/preview', (await import('../server/routes/codocs/api/dept-assets/preview.get.ts')).default)
    router.get('/departments', (await import('../server/routes/codocs/api/dept-assets/departments.get.ts')).default)
    router.post('/export-docx', (await import('../server/routes/codocs/api/dept-assets/export-docx.post.ts')).default)
    router.get('/export-policy', (await import('../server/routes/codocs/api/dept-assets/export-policy.get.ts')).default)
    router.get('/reviews', (await import('../server/routes/codocs/api/reviews/by-oss-path.get.ts')).default)
    router.post('/archive', (await import('../server/routes/codocs/api/dept-assets/archive.post.ts')).default)
    router.post('/links', (await import('../server/routes/codocs/api/published-asset-links/index.post.ts')).default)
    router.get('/links/:token', (await import('../server/routes/codocs/api/published-asset-links/[token].get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const path = 'codocs/departments/D1/records/a.md'
    const preview = `${base}/preview?path=${encodeURIComponent(path)}`
    const list = `${base}/list?deptCode=D1&subdir=records&page=1&pageSize=20`
    state.resources = { departments: [] }
    assert.equal((await fetch(list)).status, 403)
    assert.equal(state.calls.length, 0)
    state.resources = { departments: ['view', 'export', 'admin'] }
    state.role = 'none'
    assert.equal((await fetch(list)).status, 403)
    assert.equal((await fetch(preview)).status, 403)
    assert.equal((await fetch(`${base}/reviews?path=${encodeURIComponent(path)}`)).status, 403)
    for (const role of ['parent', 'leader', 'member']) {
      state.role = role
      const response = await fetch(list)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).data.total, 1)
    }
    assert.equal((await fetch(`${base}/list?deptCode=D1&subdir=records&path=..%2Fsecret`)).status, 400)
    assert.equal((await fetch(`${preview}&deptCode=D2`)).status, 400)
    state.recordDown = true
    const denied = await fetch(preview)
    assert.equal(denied.status, 503)
    assert.ok(!(await denied.text()).includes('department secret'))
    state.recordDown = false
    assert.equal((await (await fetch(preview)).json()).data.content, 'department secret')
    const record = state.calls.at(-1)
    assert.equal(record.operation, 'codocs.company-asset-record-access')
    assert.equal(record.input.payload.path, path)
    state.directoryDown = true
    assert.equal((await fetch(preview)).status, 503)
    state.directoryDown = false
    const body = JSON.stringify({ path })
    const headers = { 'Content-Type': 'application/json' }
    assert.equal((await fetch(`${base}/links`, { method: 'POST', headers, body })).status, 200)
    state.role = 'none'
    assert.equal((await fetch(`${base}/links`, { method: 'POST', headers, body })).status, 403)
    assert.equal((await fetch(`${base}/links/1234567890abcdef`)).status, 403)
    state.role = 'member'
    assert.equal((await fetch(`${base}/links/1234567890abcdef`)).status, 200)
    state.resources = { departments: ['view'] }
    const exportBody = JSON.stringify({ path: 'codocs/departments/D1/outsides/a.md' })
    const policyUrl = `${base}/export-policy?path=${encodeURIComponent('codocs/departments/D1/outsides/a.md')}`
    assert.equal((await fetch(policyUrl)).status, 403)
    assert.equal((await fetch(`${base}/export-docx`, { method: 'POST', headers, body: exportBody })).status, 403)
    state.resources = { departments: ['view', 'export', 'admin'] }
    assert.equal((await (await fetch(policyUrl)).json()).data.extra.outsideFileLevel, 'general')
    assert.equal((await fetch(`${base}/export-docx`, { method: 'POST', headers, body: exportBody })).status, 200)
    const archiveBody = JSON.stringify({ deptCode: 'D1', subdir: 'records', sourcePath: path, operationId: '550e8400-e29b-41d4-a716-446655440000' })
    state.role = 'none'
    assert.equal((await fetch(`${base}/archive`, { method: 'POST', headers, body: archiveBody })).status, 403)
    state.role = 'member'
    assert.equal((await fetch(`${base}/archive`, { method: 'POST', headers, body: JSON.stringify({ ...JSON.parse(archiveBody), deptCode: 'D2' }) })).status, 400)
    assert.equal((await fetch(`${base}/archive`, { method: 'POST', headers, body: archiveBody })).status, 200)
    assert.equal(state.objects.has(path), false)
    assert.equal(state.objects.has('codocs/archives/departments/D1/records/a.md'), true)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.__departmentAssetsState = oldState
    globalThis.defineEventHandler = oldDefine
  }
})
