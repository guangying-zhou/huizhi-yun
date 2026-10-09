import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('People machine recovery uses only a frozen actor/form/key, validates Workflow and binds the same intent after response loss', async () => {
  const frozen = { id: '8', employeeUid: 'employee', actor: 'HR', bizId: 'ASN-marked', key: 'people:assignment:8:original', operationKey: 'people:assignment:8:original', expectedVersion: 2, snapshotHash: 'a'.repeat(64), formData: { id: '8', employee_uid: 'employee', requestedBy: 'HR', snapshotHash: 'a'.repeat(64) } }
  globalThis.__peopleRecovery = { calls: [], frozen, fail: true }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'original';export const getQuery=()=>({});export const getRouterParam=()=> '8';export const readBody=async()=>({employeeUid:'employee',expectedVersion:1});export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      source = `export const requireEnterpriseUser=async()=>{throw Error('machine must not ask for user session')}`
    if (specifier === './enterprisePeopleFacts')
      source = `export const normalizePeopleFacts=()=>{};export const executePeopleFacts=async()=>{throw Error('machine must not call user write')}`
    if (specifier.endsWith('/enterpriseRuntimeChannels'))
      source = `export const callEnterpriseSystemRuntime=async()=>{};export const callEnterprisePeopleApprovalWorker=async(e,op,body)=>{const s=globalThis.__peopleRecovery;s.calls.push({op,body});return {code:0,data:op==='pending'?[s.frozen]:{bound:true,instanceId:'19'}}}`
    if (specifier === './enterpriseWorkflowProxy')
      source = `export const workflowRequest=async(e,actor,path,opts)=>{const s=globalThis.__peopleRecovery;s.calls.push({actor,path,opts});if(path==='instances/prepare')return {code:0,data:{action_def:{id:2,app_code:'people',resource_code:'assignments',action_code:'change'},matched_routes:[{id:3}]}};if(s.fail)throw Object.assign(Error('response lost'),{statusCode:503});return {code:0,data:{instance_id:19}}}`
    return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(specifier, context)
  } })
  try {
    const { resumePeopleAssignmentApprovals } = await import('../server/utils/enterprisePeopleWorkflow.ts')
    await assert.rejects(resumePeopleAssignmentApprovals({}), { statusCode: 503 })
    assert.equal(globalThis.__peopleRecovery.calls.some(c => c.op === 'bind'), false)
    globalThis.__peopleRecovery.fail = false
    assert.deepEqual(await resumePeopleAssignmentApprovals({}), { resumed: 1, remaining: 0 })
    const creates = globalThis.__peopleRecovery.calls.filter(c => c.path === 'instances')
    assert.equal(creates.length, 2)
    for (const c of creates) {
      assert.equal(c.actor, 'HR')
      assert.equal(c.opts.key, frozen.key)
      assert.deepEqual(c.opts.body.form_data, frozen.formData)
      assert.ok(c.opts.timeoutMs > 0 && c.opts.timeoutMs <= 3000)
    }
    assert.deepEqual(globalThis.__peopleRecovery.calls.at(-1).body, { operationKey: frozen.operationKey, workflowInstanceId: '19' })
    globalThis.__peopleRecovery.calls = []
    frozen.formData.requestedBy = 'forged'
    await assert.rejects(resumePeopleAssignmentApprovals({}), { statusCode: 503 })
    assert.deepEqual(globalThis.__peopleRecovery.calls.map(c => c.op), ['pending'])
  } finally {
    hooks.deregister()
    delete globalThis.__peopleRecovery
  }
})
