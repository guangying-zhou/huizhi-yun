import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

test('user recovery uses only frozen intent, preserves original key and never drains Directory', async () => {
  const f = { id: '8', employeeUid: 'employee', actor: 'HR', bizId: 'ASN-8', key: 'people:assignment:8:original', operationKey: 'people:assignment:8:original', expectedVersion: 2, snapshotHash: 'a'.repeat(64), formData: { id: '8', employee_uid: 'employee', requestedBy: 'HR', snapshotHash: 'a'.repeat(64) } }
  globalThis.__userRecovery = { f, calls: [], status: 0, bound: false, raw: { employeeUid: 'employee', expectedVersion: 2 } }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let s
    if (specifier === 'h3')
      s = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'different-browser-key';export const getQuery=()=>({});export const getRouterParam=()=> '8';export const readBody=async()=>globalThis.__userRecovery.raw;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      s = `export const requireEnterpriseUser=async()=>({uid:'HR'})`
    if (specifier.endsWith('/enterpriseRuntimeChannels'))
      s = `export const callEnterpriseSystemRuntime=async()=>{throw Error('not allowed')};export const callEnterprisePeopleApprovalWorker=async()=>{throw Error('no machine wake allowed')}`
    if (specifier === './enterprisePeopleFacts')
      s = `export const normalizePeopleFacts=(op,id,raw)=>({id,employeeUid:raw.employeeUid,payload:raw});export const executePeopleFacts=async(e,op,body,key)=>{const s=globalThis.__userRecovery;s.calls.push({op,body,key});if(s.status)throw Object.assign(Error('rejected'),{statusCode:s.status});return {code:0,data:{data:{id:'8',row_version:2,approval_status:'pending',workflow_instance_id:s.bound||op==='assignments-attach-workflow'?'39':null,frozenApproval:s.f}}}}`
    if (specifier === './enterpriseWorkflowProxy')
      s = `export const workflowRequest=async(e,actor,path,opts)=>{globalThis.__userRecovery.calls.push({actor,path,opts});return {code:0,data:path==='instances/prepare'?{action_def:{id:1,app_code:'people',resource_code:'assignments',action_code:'change'},matched_routes:[{id:2}]}:{instance_id:39}}}`
    return s ? { url: 'data:text/javascript,' + encodeURIComponent(s), shortCircuit: true } : next(specifier, context)
  } })
  try {
    const { enterprisePeopleAssignmentRecover: recover } = await import('../server/utils/enterprisePeopleWorkflow.ts')
    await recover({})
    const calls = globalThis.__userRecovery.calls
    assert.equal(calls[0].body.payload.phase, 'recover')
    assert.equal(calls.find(c => c.path === 'instances').opts.key, f.operationKey)
    assert.deepEqual(calls.find(c => c.path === 'instances').opts.body.form_data, f.formData)
    assert.equal(calls.at(-1).key, 'original:bind')
    assert.equal(calls.at(-1).body.payload.workflowInstanceId, '39')
    for (const status of [403, 409]) {
      globalThis.__userRecovery.status = status
      globalThis.__userRecovery.calls = []
      await assert.rejects(recover({}), { statusCode: status })
      assert.equal(globalThis.__userRecovery.calls.length, 1)
    }
    globalThis.__userRecovery.status = 0
    globalThis.__userRecovery.bound = true
    globalThis.__userRecovery.calls = []
    await recover({})
    assert.equal(globalThis.__userRecovery.calls.length, 1)
    globalThis.__userRecovery.raw.workflowInstanceId = 'forged'
    await assert.rejects(recover({}), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__userRecovery
  }
})
test('recovery route and detail are registered and guarded without Directory drain', () => {
  const src = readFileSync(new URL('../server/utils/enterprisePeopleWorkflow.ts', import.meta.url), 'utf8').split('export async function enterprisePeopleAssignmentRecover')[1]
  assert.doesNotMatch(src, /drain|resumePeopleAssignmentApprovals|callEnterprisePeopleApprovalWorker/)
  const page = readFileSync(new URL('../app/components/PeopleReadPage.vue', import.meta.url), 'utf8')
  assert.match(page, /created_by === user.value/)
  assert.match(page, /hasPermission\('assignments', 'edit'\)/)
  assert.match(page, /审批已提交但尚未关联流程实例/)
  const routes = readFileSync(new URL('../composition/business-api-routes.generated.mjs', import.meta.url), 'utf8')
  assert.match(routes, /assignments\/:id\/recover/)
})
