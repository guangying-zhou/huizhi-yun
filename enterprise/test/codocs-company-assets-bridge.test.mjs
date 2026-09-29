import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createApp, createRouter, toNodeListener } from 'h3'

test('company preview records access before content and fails closed on audit failure', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { resources: { company: ['view', 'admin'] }, recordMode: 'ok', runtimeCalls: [], objects: new Map([['codocs/company/rules/a.md', Buffer.from('secret company text')]]) }
  const oldState = globalThis.__companyBridgeState
  const oldDefine = globalThis.defineEventHandler
  globalThis.__companyBridgeState = state
  globalThis.defineEventHandler = value => value
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
        export const requireEnterpriseUser=async()=>({uid:'member-a',tenant:'C000001',deployment:'enterprise-a'})
        export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000
        export const prepareEnterpriseRuntime=async()=>{}
        export const callEnterpriseRuntime=async(_event,operation,input,options)=>{const s=globalThis.__companyBridgeState;s.runtimeCalls.push({operation,input,options});if(s.recordMode==='fail')throw Object.assign(new Error('database down'),{statusCode:500});return {success:true,data:{recorded:true,id:input.payload?.eventId,operationId:input.payload?.operationId,action:operation.split('company-asset-')[1]?.split('-').slice(0,-1).join('-'),phase:operation.endsWith('prepare')?'prepare':'complete'}}}
      `
      if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__companyBridgeState.resources,actionPolicies:{}})`
      if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true`
      if (specifier.endsWith('/oss')) source = `export const createRuntimeOSSClient=async()=>({get:async path=>{const bytes=globalThis.__companyBridgeState.objects.get(path);if(!bytes)throw Object.assign(new Error('missing'),{status:404});return {content:bytes}},head:async path=>{if(!globalThis.__companyBridgeState.objects.has(path))throw Object.assign(new Error('missing'),{status:404});return {meta:{},res:{headers:{etag:'etag-1'}}}}})`
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
    router.get('/preview', (await import('../server/routes/codocs/api/company-assets/preview.get.ts')).default)
    router.post('/mkdir', (await import('../server/routes/codocs/api/company-assets/mkdir.post.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${server.address().port}/preview?path=codocs%2Fcompany%2Frules%2Fa.md`
    state.resources = { company: [] }
    assert.equal((await fetch(url)).status, 403)
    assert.equal(state.runtimeCalls.length, 0)
    state.resources = { company: ['view'] }
    state.recordMode = 'fail'
    const failed = await fetch(url)
    assert.equal(failed.status, 503)
    assert.ok(!(await failed.text()).includes('secret company text'))
    state.recordMode = 'ok'
    const success = await fetch(url)
    assert.equal(success.status, 200)
    assert.equal((await success.json()).data.content, 'secret company text')
    const call = state.runtimeCalls.at(-1)
    assert.equal(call.operation, 'codocs.company-asset-record-access')
    assert.equal(call.input.authorization.actorUid, 'member-a')
    assert.equal(call.input.authorization.action, 'record-access')
    assert.ok(call.options.idempotencyKey.startsWith('codocs:company-access:'))
    assert.equal((await fetch(`${url}%2F..%2Fsecret.md`)).status, 400)
    const mkdir = body => fetch(`http://127.0.0.1:${server.address().port}/mkdir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const operationId = '550e8400-e29b-41d4-a716-446655440000'
    state.resources = { company: ['view'] }
    const beforeDenied = state.runtimeCalls.length
    assert.equal((await mkdir({ operationId, subdir: 'rules', name: 'new' })).status, 403)
    assert.equal(state.runtimeCalls.length, beforeDenied)
    state.resources = { company: ['admin'] }
    assert.equal((await mkdir({ operationId, subdir: 'rules', name: '../escape' })).status, 400)
    assert.equal((await mkdir({ operationId, subdir: 'products', name: 'new' })).status, 400)
    assert.equal(state.runtimeCalls.length, beforeDenied)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.__companyBridgeState = oldState
    globalThis.defineEventHandler = oldDefine
  }
})
