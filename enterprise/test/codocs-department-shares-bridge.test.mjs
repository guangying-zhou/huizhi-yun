import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createApp, createRouter, toNodeListener } from 'h3'

test('department share Host requires personnel and current R, rejects forged department, and keeps intent key', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { permissions: { departments: ['view', 'edit'] }, role: 'manager', directoryDown: false, notifyDown: false, notifications: [], calls: [], intents: new Map() }
  globalThis.__departmentSharesTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'manager',tenant:'C000001',deployment:'enterprise-test'})
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000
      export const prepareEnterpriseRuntime=async()=>{}
      export const callEnterpriseRuntime=async(_event,operation,input,options)=>{const s=globalThis.__departmentSharesTest;s.calls.push({operation,input,options});
        if(operation==='codocs.department-access-resolve'){if(s.directoryDown)throw Object.assign(Error('down'),{statusCode:503});let role=input.code==='D1'?s.role:'none';return {success:true,data:{role,canRead:role!=='none',canManage:role==='manager'}}}
        if(operation==='codocs.department-shares-list')return {success:true,data:{items:[{id:4,dept_code:'D1',from_uid:'author',document_title:'Test',mode:'transfer'}],total:1,page:1,pageSize:20}}
        if(operation==='codocs.department-shares-decide'){
          if(input.code!=='D1')throw Object.assign(Error('scope'),{statusCode:403});
          const old=s.intents.get(options.idempotencyKey),next=JSON.stringify(input.payload);
          if(old&&old!==next)throw Object.assign(Error('conflict'),{statusCode:409});s.intents.set(options.idempotencyKey,next);
          return {success:true,data:{shareId:4,documentUuid:'doc-1',documentTitle:'Test',senderUid:'author',departmentCode:'D1',status:input.payload.action==='accept'?'accepted':'rejected'}}}
        throw Error(operation)}
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__departmentSharesTest.permissions,actionPolicies:{}})`
    if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true`
    if (specifier.endsWith('/oss')) source = `export const createRuntimeOSSClient=async()=>({})`
    if (specifier.endsWith('/cabinetTextPreview')) source = `export const CABINET_TEXT_PREVIEW_EXTENSIONS=new Set();export const readCabinetTextPreview=async()=>({})`
    if (specifier.endsWith('/enterpriseCodocsNotification')) source = `export const sendEnterpriseCodocsNotification=async input=>{const s=globalThis.__departmentSharesTest;if(s.notifyDown)throw Error('notification down');if(!s.notifications.some(row=>row.idempotencyKey===input.idempotencyKey))s.notifications.push(input);return {}}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let path
    if (specifier.startsWith('@hzy/foundation/')) path = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const bridge = await import('../server/utils/enterpriseCodocsDepartmentShares.ts')
    const app = createApp(), router = createRouter()
    router.get('/shares', event => bridge.enterpriseCodocsDepartmentShares(event, 'list'))
    router.patch('/shares/:id', event => bridge.enterpriseCodocsDepartmentShares(event, 'decide'))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const list = `${base}/shares?dept_code=D1`
    state.permissions.departments = []
    assert.equal((await fetch(list)).status, 403)
    state.permissions.departments = ['view', 'edit']
    state.role = 'none'
    assert.equal((await fetch(list)).status, 403)
    state.role = 'parent'
    assert.equal((await fetch(list)).status, 200)
    state.directoryDown = true
    assert.equal((await fetch(list)).status, 503)
    state.directoryDown = false
    assert.equal((await fetch(`${list}&owner_uid=author`)).status, 400)
    const decide = (body, key = 'intent-12345678', dept = 'D1') => fetch(`${base}/shares/4?dept_code=${dept}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
    assert.equal((await decide({ action: 'accept' })).status, 403)
    state.role = 'manager'
    assert.equal((await decide({ action: 'accept', dept_code: 'D2' })).status, 400)
    assert.equal((await decide({ action: 'accept', owner_uid: 'victim' })).status, 400)
    assert.equal((await decide({ action: 'accept' }, 'intent-12345678', 'D2')).status, 403)
    state.notifyDown = true
    assert.equal((await decide({ action: 'accept' })).status, 503)
    state.notifyDown = false
    assert.equal((await decide({ action: 'accept' })).status, 200)
    assert.equal((await decide({ action: 'accept' })).status, 200)
    assert.equal(state.notifications.length, 1)
    assert.equal(state.notifications[0].touser[0], 'author')
    assert.equal((await decide({ action: 'reject' })).status, 409)
    const call = state.calls.findLast(row => row.operation === 'codocs.department-shares-decide')
    assert.equal(call.input.authorization.resource, 'department-shares')
    assert.equal(call.input.authorization.action, 'edit')
    assert.equal(call.input.payload.dept_code, undefined)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__departmentSharesTest
  }
})
