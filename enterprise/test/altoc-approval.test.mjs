import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

test('Altoc submit freezes current scoped intent, creates formal flow, reauthorizes bind and keeps the same key on uncertain delivery', async () => {
  globalThis.__approval = { calls: [], denied: false, failed: false, version: 2 }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3')
      source = `export const createError=x=>Object.assign(Error(x.message||'fixed'),x);export const getHeader=()=> 'original-key';export const getQuery=()=>({});export const getRouterParam=()=> '1';export const readBody=async()=>({expectedVersion:globalThis.__approval.version});export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'T',deployment:'D'});export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(e,op,body,opts)=>{globalThis.__approval.calls.push({op,body,opts});const resource=op.includes('quotation')?'quotation':'contract';return {code:0,data:op.endsWith('-request')?{resource,bizId:'1',actor:'actor',title:'Marked',key:opts.idempotencyKey,expectedVersion:2,requestNo:'APF-stable',formData:{requestNo:'APF-stable'}}:{bound:true,instanceId:'31'}}}`
    if (specifier.endsWith('/enterpriseRuntimeChannels'))
      source = `export const callEnterpriseAltocApprovalWorker=async()=>({code:0,data:[]})`
    if (specifier === './enterpriseAPF')
      source = `export const buildAPFPermit=async(e,d,op,input,user,resource)=>{if(globalThis.__approval.denied)throw Object.assign(Error('denied'),{statusCode:403});return {resource,action:'edit',actorUid:user.uid,objectId:input.id}}`
    if (specifier === './enterpriseWorkflowProxy')
      source = `export const workflowRequest=async(e,uid,path,opts)=>{globalThis.__approval.calls.push({uid,path,opts});if(globalThis.__approval.failed)throw Object.assign(Error('unknown'),{statusCode:503});return {code:0,data:path==='instances/prepare'?{action_def:{id:9,app_code:'altoc',resource_code:opts.body.resource_code,action_code:'approve'},matched_routes:[{id:4}]}:{instance_id:31,instance_no:'MARKED'}}}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { submitAltocApproval, enterpriseAltocContractSubmit } = await import('../server/utils/enterpriseAltocApproval.ts')
    for (const resource of ['quotation', 'contract']) {
      globalThis.__approval.calls = []
      const result = await submitAltocApproval({}, resource, '1', 2)
      assert.equal(result.data.submitted, true)
      const calls = globalThis.__approval.calls
      assert.equal(calls[0].body.authorization.resource, resource)
      assert.equal(calls[0].body.authorization.action, 'edit')
      assert.equal(calls[0].opts.idempotencyKey, 'original-key')
      assert.equal(calls[2].opts.key, 'APF-stable')
      assert.equal(calls[2].opts.body.callback_url, '/api/v1/service/workflow/callback')
      assert.equal(calls[2].uid, 'actor')
      assert.equal(calls[3].opts.idempotencyKey, 'original-key')
      assert.equal(calls[3].body.rowVersion, 2)
    }
    globalThis.__approval.denied = true
    globalThis.__approval.calls = []
    await assert.rejects(submitAltocApproval({}, 'quotation', '1', 2), { statusCode: 403 })
    assert.equal(globalThis.__approval.calls.length, 0)
    globalThis.__approval.denied = false
    globalThis.__approval.failed = true
    await assert.rejects(submitAltocApproval({}, 'contract', '1', 2), e => e.statusCode === 503 && e.data.requestFrozen === true)
    globalThis.__approval.failed = false
    assert.equal((await enterpriseAltocContractSubmit({})).data.submitted, true)
    assert.equal(globalThis.__approval.calls.filter(c => c.op?.endsWith('-request')).every(c => c.opts.idempotencyKey === 'original-key'), true)
    for (const version of [0, -1, '2', 1.5])
      await assert.rejects(submitAltocApproval({}, 'contract', '1', version), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__approval
  }
})
test('Contract submit is a distinct exact route; shared ingress authenticates before Altoc dispatch', () => {
  const route = readFileSync(new URL('../server/routes/altoc/api/v1/contracts/[contractId]/submit.post.ts', import.meta.url), 'utf8')
  assert.match(route, /enterpriseAltocContractSubmit/)
  assert.doesNotMatch(route, /obligations/)
  const receiver = readFileSync(new URL('../server/routes/enterprise/api/v1/service/workflow/callback.post.ts', import.meta.url), 'utf8')
  assert.ok(receiver.indexOf('await requireEnterpriseAimsServiceIngress') < receiver.indexOf('body?.app_code === \'altoc\''))
  assert.match(receiver, /\['quotation', 'contract'\]/)
  assert.match(receiver, /altoc.approval-callback/)
})
