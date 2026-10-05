import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createApp, createRouter, toNodeListener } from 'h3'

test('department cabinet Host binds personnel, current R, object department and intent receipt', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { permissions: { departments: ['view', 'edit', 'create', 'export'] }, role: 'manager', directoryDown: false, calls: [], intents: new Map() }
  globalThis.__departmentCabinetTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'C000001',deployment:'enterprise-test'})
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000
      export const prepareEnterpriseRuntime=async()=>{}
      export const callEnterpriseRuntime=async(_event,operation,input,options)=>{const s=globalThis.__departmentCabinetTest;s.calls.push({operation,input,options});
        if(operation==='codocs.department-access-resolve'){if(s.directoryDown)throw Object.assign(Error('down'),{statusCode:503});let role=input.code==='D1'?s.role:'none';return {success:true,data:{role,canRead:role!=='none',canManage:role==='manager'}}}
        if(operation==='codocs.department-cabinet-list')return {success:true,data:{items:[{uuid:'file-1',owner_uid:'other',dept_code:'D1',project_code:null,oss_path:'codocs/departments/D1/cabinet/file-1/hash.pdf',original_name:'plan.pdf',file_ext:'pdf',file_size:5}],total:1,page:1,pageSize:20}}
        if(operation==='codocs.department-cabinet-update'){
          const old=s.intents.get(options.idempotencyKey),next=JSON.stringify(input.payload);
          if(old&&old!==next)throw Object.assign(Error('conflict'),{statusCode:409});s.intents.set(options.idempotencyKey,next);
          return {success:true,data:{id:input.payload.uuid}}}
        throw Error(operation)}
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__departmentCabinetTest.permissions,actionPolicies:{}})`
    if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true`
    if (specifier.endsWith('/oss')) source = `export const createRuntimeOSSClient=async()=>({})`
    if (specifier.endsWith('/cabinetTextPreview')) source = `export const CABINET_TEXT_PREVIEW_EXTENSIONS=new Set();export const readCabinetTextPreview=async()=>({})`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let path
    if (specifier.startsWith('@hzy/foundation/')) path = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const reads = await import('../server/utils/enterpriseCodocsDepartmentCabinet.ts')
    const writes = await import('../server/utils/enterpriseCodocsDepartmentCabinetWrites.ts')
    const app = createApp(), router = createRouter()
    router.get('/list', event => reads.readEnterpriseDepartmentCabinet(event, 'list'))
    router.patch('/file/:uuid', event => writes.writeEnterpriseDepartmentCabinet(event, 'update'))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const list = `${base}/list?dept_code=D1&page=1&pageSize=20`
    state.permissions.departments = []
    assert.equal((await fetch(list)).status, 403)
    assert.equal(state.calls.length, 0)
    state.permissions.departments = ['view', 'edit', 'create', 'export']
    state.role = 'none'
    assert.equal((await fetch(list)).status, 403)
    state.role = 'parent'
    assert.equal((await fetch(list)).status, 200)
    assert.equal((await fetch(`${list}&owner_uid=victim`)).status, 400)
    assert.equal((await fetch(`${base}/list?dept_code=D2`)).status, 403)
    state.directoryDown = true
    assert.equal((await fetch(list)).status, 503)
    state.directoryDown = false
    const write = (body, key = 'intent-12345678') => fetch(`${base}/file/file-1?dept_code=D1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
    assert.equal((await write({ filename: 'x.pdf' })).status, 403)
    state.role = 'manager'
    assert.equal((await write({ filename: 'x.pdf', dept_code: 'D2' })).status, 400)
    assert.equal((await write({ filename: 'x.pdf', owner_uid: 'victim' })).status, 400)
    assert.equal((await write({ filename: 'x.pdf' })).status, 200)
    assert.equal((await write({ filename: 'x.pdf' })).status, 200)
    assert.equal((await write({ filename: 'y.pdf' })).status, 409)
    const last = state.calls.at(-1)
    assert.equal(last.input.authorization.resource, 'department-cabinet')
    assert.equal(last.input.authorization.action, 'edit')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__departmentCabinetTest
  }
})
