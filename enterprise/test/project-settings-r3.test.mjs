import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

test('R3 narrow lifecycle request freezes business identity, reauthorizes bind and resumes the same intent', async () => {
  const state = { calls: [], workflows: [], permits: [], denied: false, failedCreate: false, bound: false }
  globalThis.__r3 = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const source = specifier === 'h3'
      ? `export const createError=o=>Object.assign(new Error(o.message),o);export const getHeader=(e,k)=>e.headers[k];export const getQuery=e=>e.query||{};export const getRouterParam=(e,k)=>e.params[k];export const readBody=async e=>e.body;export const setHeader=()=>{}`
      : specifier.endsWith('/enterpriseRuntimeClient')
        ? `export const requireEnterpriseUser=async()=>({uid:'manager',tenant:'T1',deployment:'host'});export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(_e,op,body,options)=>{const s=globalThis.__r3;s.calls.push({op,body,options});if(op==='aims.project-lifecycle-bind'){s.bound=true;return {code:0,data:{bound:true,instanceId:body.payload.instanceId}}}if(op==='aims.project-modules-update')return {code:0,data:{}};return {code:0,data:{requestNo:'PLC-fixed',status:'pending',instanceId:s.bound?'44':'',snapshot:{projectId:'7',actionCode:body.payload.actionCode,requestedBy:'manager',comment:'frozen reason',expectedVersion:'a'.repeat(64)}}}}`
        : specifier.endsWith('/projectCommandAuthorization')
          ? `export const loadProjectCommandAuthorization=async(_e,_u,target)=>{const s=globalThis.__r3;s.permits.push(target);if(s.denied)throw Object.assign(new Error('denied'),{statusCode:403});return {...target,expiresAt:Date.now()+10000,scope:{version:1,masks:[1]}}}`
          : specifier === './enterpriseWorkflowProxy'
            ? `export const workflowRequest=async(_e,uid,path,options)=>{const s=globalThis.__r3;s.workflows.push({uid,path,options});if(path==='instances/prepare')return {code:0,data:{action_def:{id:1,resource_code:'projects',action_code:options.body.action_code},matched_routes:[{id:2}]}};if(s.failedCreate)throw Object.assign(new Error('lost'),{statusCode:503});return {code:0,data:{instance_id:44,instance_no:"WF44"}}}`
            : null
    return source ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` } : next(specifier, context)
  } })
  try {
    const { enterpriseAimsProjectLifecycle: lifecycle, enterpriseAimsProjectModules: modules } = await import('../server/utils/enterpriseAimsProjectLifecycle.ts')
    const event = { params: { id: '7' }, headers: { 'idempotency-key': 'intent-7' }, body: { actionCode: 'finish', comment: 'browser reason', expectedVersion: 'a'.repeat(64) } }
    state.failedCreate = true
    await assert.rejects(lifecycle(event), error => error.statusCode === 503 && error.data.requestFrozen === true)
    assert.equal(state.calls.length, 1, 'creation failure leaves the Runtime intent unbound')
    state.failedCreate = false
    const result = await lifecycle(event)
    assert.equal(result.data.instanceId, '44')
    const creation = state.workflows.at(-1)
    assert.equal(creation.uid, 'manager')
    assert.equal(creation.options.key, 'PLC-fixed')
    assert.equal(creation.options.body.biz_id, '7')
    assert.equal(creation.options.body.form_data.comment, 'frozen reason', 'browser form is never forwarded')
    assert.equal(state.calls.at(-1).op, 'aims.project-lifecycle-bind')
    assert.equal(state.calls.at(-1).body.payload.instanceNo, 'WF44')
    assert.equal(state.calls.at(-1).options.idempotencyKey, 'intent-7')
    assert.ok(state.permits.every(permit => permit.action === 'close'))
    const workflows = state.workflows.length
    await lifecycle(event)
    assert.equal(state.workflows.length, workflows, 'bound replay never creates another instance')
    for (const body of [{ ...event.body, form_data: {} }, { ...event.body, approved: true }, { ...event.body, lifecycleStatus: 'completed' }, { ...event.body, actionCode: 'archive' }]) {
      const count = state.calls.length
      await assert.rejects(lifecycle({ ...event, body }), { statusCode: 400 })
      assert.equal(state.calls.length, count)
    }
    state.denied = true
    await assert.rejects(lifecycle(event), { statusCode: 403 })
    state.denied = false
    const config = Object.fromEntries(['milestones', 'workflows', 'requirements', 'releases', 'environments', 'service_desk', 'decomposition'].map(key => [key, false]))
    await modules({ ...event, body: { expectedVersion: 'a'.repeat(64), expectedModuleConfig: null, moduleConfig: config } })
    assert.equal(state.calls.at(-1).op, 'aims.project-modules-update')
    assert.equal(state.calls.at(-1).body.projectWriteAuthorization.action, 'edit')
    for (const invalid of [{ ...config, milestones: 'true' }, { ...config, extra: true }, []]) {
      await assert.rejects(modules({ ...event, body: { expectedVersion: 'a'.repeat(64), expectedModuleConfig: null, moduleConfig: invalid } }), { statusCode: 400 })
    }
  } finally {
    hooks.deregister()
    delete globalThis.__r3
  }
})

test('R3 Workflow scope is narrowly extended while generic prepare/create stays closed', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
  const proxy = read('../server/utils/enterpriseWorkflowProxy.ts')
  assert.match(proxy, /lifecycleWorkflowKeys = \['aims\/projects\/pause', 'aims\/projects\/resume', 'aims\/projects\/finish'\]/)
  assert.match(proxy, /if \(query\.resource_code === 'projects'\) await projectRead/)
  const boundary = read('../server/middleware/02-workflow-boundary.ts')
  assert.doesNotMatch(boundary, /instances\/prepare|operation.*create/)
  const client = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  for (const operation of ['project-lifecycle-request', 'project-lifecycle-bind', 'project-modules-update']) assert.ok(client.includes(`aims.${operation}`))
})
