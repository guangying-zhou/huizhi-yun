import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createApp, createRouter, toNodeListener } from 'h3'

const uuid = '00000000-0000-4000-8000-0000000000aa'

test('personal generic read falls back to the department read path server-side without widening access', async () => {
  const root = resolve(import.meta.dirname, '../..')
  // memberOf: departments the caller belongs to. docDept: department the document belongs to (null = personal).
  const state = { resources: { documents: ['view'], departments: ['view'] }, memberOf: ['D1', 'D2'], docDept: 'D2', personalStatus: 403, listFails: false, serviceDown: false, calls: [] }
  const oldState = globalThis.__fallbackState, oldDefine = globalThis.defineEventHandler
  globalThis.__fallbackState = state
  globalThis.defineEventHandler = value => value
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'member',tenant:'C000001',deployment:'C000001-test-enterprise'})
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000
      export const prepareEnterpriseRuntime=async()=>{}
      export const callEnterpriseRuntime=async(_event,operation,input)=>{const s=globalThis.__fallbackState;s.calls.push({operation,input});
        if(operation==='console.directory-self-accessible-departments'){if(s.listFails)throw Error('down');return {data:s.memberOf.map(deptCode=>({deptCode,name:deptCode}))}}
        if(operation==='codocs.personal-document-view'){if(s.personalStatus===200)return {success:true,data:{uuid:input.code,doc_type:'private',owner_uid:'member'}};throw Object.assign(new Error('denied'),{statusCode:s.personalStatus})}
        if(operation==='codocs.department-documents-view'){
          if(s.serviceDown&&input.code===s.docDept)throw Object.assign(new Error('boom'),{statusCode:500})
          if(!s.memberOf.includes(input.code))throw Object.assign(new Error('not member'),{statusCode:403})
          if(input.code!==s.docDept)throw Object.assign(new Error('mismatch'),{statusCode:404})
          return {success:true,data:{uuid:input.subId,title:'Team note',doc_type:'department',dept_code:input.code,owner_uid:'other',oss_path:'internal/secret'}}}
        throw Error(operation)}
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__fallbackState.resources,actionPolicies:{}})`
    if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true`
    if (specifier.endsWith('/enterpriseCodocsDocumentContent')) source = `export const withEnterpriseCodocsDocumentContent=async(_event,response)=>response;export const readLegacyMarkdown=async()=>''`
    if (specifier.endsWith('/codocs/server/utils/oss')) source = `export const createRuntimeOSSClient=async()=>({});export const resolveDocumentOssTimeoutMs=()=>8000`
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
    router.get('/documents/:uuid', (await import('../server/routes/codocs/api/documents/[uuid].get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const read = async (query = '') => {
      state.calls.length = 0
      const response = await fetch(`${base}/documents/${uuid}${query}`)
      return { status: response.status, body: await response.json().catch(() => ({})) }
    }
    const deptCalls = () => state.calls.filter(call => call.operation === 'codocs.department-documents-view')

    // Member without dept_code: 403 from the personal read is resolved through the department read path.
    let result = await read()
    assert.equal(result.status, 200)
    assert.equal(result.body.data.doc_type, 'department')
    assert.equal(result.body.data.dept_code, 'D2')
    assert.equal('oss_path' in result.body.data, false)
    assert.deepEqual(deptCalls().map(call => call.input.code), ['D1', 'D2'])
    assert.ok(deptCalls().every(call => call.input.subId === uuid && call.input.authorization.actorUid === 'member' && call.input.authorization.resource === 'department-documents'))

    // A client-supplied department is never used as authority or candidate.
    state.docDept = 'D9'
    result = await read('?dept_code=D9')
    assert.equal(result.status, 403)
    assert.equal(deptCalls().some(call => call.input.code === 'D9'), false)
    state.docDept = 'D2'

    // Non-member (document in a department the caller does not belong to): same 403 as before.
    state.memberOf = ['D1']
    result = await read()
    assert.equal(result.status, 403)
    assert.deepEqual(deptCalls().map(call => call.input.code), ['D1'])
    state.memberOf = ['D1', 'D2']

    // True personal document of someone else: probes miss, the original 403 stays.
    state.docDept = null
    result = await read()
    assert.equal(result.status, 403)
    state.docDept = 'D2'

    // No departments / directory unavailable / missing departments:view: no probing, original 403.
    state.memberOf = []
    assert.equal((await read()).status, 403)
    assert.equal(deptCalls().length, 0)
    state.memberOf = ['D1', 'D2']
    state.listFails = true
    assert.equal((await read()).status, 403)
    state.listFails = false
    state.resources = { documents: ['view'] }
    assert.equal((await read()).status, 403)
    assert.equal(deptCalls().length, 0)
    state.resources = { documents: ['view'], departments: ['view'] }

    // Not found stays 404 and never reaches the fallback; a personal success never probes.
    state.personalStatus = 404
    assert.equal((await read()).status, 404)
    assert.equal(deptCalls().length, 0)
    state.personalStatus = 200
    result = await read()
    assert.equal(result.status, 200)
    assert.equal(result.body.data.doc_type, 'private')
    assert.equal(deptCalls().length, 0)
    state.personalStatus = 403

    // A service failure in the owning department is not disguised as a permission miss.
    state.serviceDown = true
    assert.equal((await read()).status, 503)
    state.serviceDown = false
  } finally {
    await new Promise(done => server ? server.close(done) : done())
    hooks.deregister()
    globalThis.defineEventHandler = oldDefine
    globalThis.__fallbackState = oldState
  }
})
