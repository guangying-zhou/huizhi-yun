import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

test('Finance exact submit freezes, creates, binds with original intent and retries unknown outcomes', async () => {
  globalThis.__financeApproval = { calls: [], failed: false, denied: false, version: 2, body: { expectedVersion: 2 }, params: { code: 'IR1', contractId: '1', scheduleCode: 'BS1' } }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error(x.message||'fixed'),x);export const getHeader=()=>globalThis.__financeApproval.body.recover?'fresh-browser-key':'original-key';export const getQuery=()=>({});export const getRouterParam=(_,k)=>globalThis.__financeApproval.params[k];export const readBody=async()=>globalThis.__financeApproval.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'T',deployment:'D'});export const callEnterpriseRuntime=async(e,op,body,opts)=>{globalThis.__financeApproval.calls.push({op,body:structuredClone(body),opts});return {code:0,data:(op.endsWith('-request')||op.endsWith('-submit')&&body.finance.payload.phase!=='bind')?{resource:globalThis.__financeApproval.action?'expenses':'invoices',action:globalThis.__financeApproval.action,bizId:globalThis.__financeApproval.params.code,actor:'actor',title:'Marked',key:body.finance.payload.phase==='recover'?'original-key':opts.idempotencyKey,expectedVersion:2,requestNo:'APF-FIN-stable',formData:{requestNo:'APF-FIN-stable'}}:(op.endsWith('-bind')||body.finance?.payload.phase==='bind')?{bound:true,instanceId:'31'}:{data:{code:'IR-SOURCE'}}}}`
    if (specifier.endsWith('/enterpriseRuntimeChannels')) source = `export const callEnterpriseFinanceApprovalWorker=async()=>({code:0,data:[]})`
    if (specifier === './enterpriseFinanceLedger') source = `export const normalizeFinanceLedgerRequest=(op,code,q,payload)=>({code,payload});export const authorizeFinanceLedger=async(e,op,finance)=>{if(globalThis.__financeApproval.denied)throw Object.assign(Error('denied'),{statusCode:403});return {op:'finance.'+(op==='payment-requests-submit'?'13b-':op.endsWith('-submit')?'13a-':'11b-')+op,authorization:{resource:op.endsWith('-submit')?'expenses':'invoices',action:'edit',actorUid:'actor'},key:'original-key'}}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(e,app,op,i,u,resource)=>({resource,action:'edit',actorUid:u.uid,objectId:i.id})`
    if (specifier === './enterpriseWorkflowProxy') source = `export const workflowRequest=async(e,uid,path,opts)=>{globalThis.__financeApproval.calls.push({uid,path,opts});if(globalThis.__financeApproval.failed)throw Object.assign(Error('lost'),{statusCode:503});return {code:0,data:path==='instances/prepare'?{action_def:{id:9,app_code:globalThis.__financeApproval.prepareApp===null?undefined:globalThis.__financeApproval.prepareApp||'finance',resource_code:globalThis.__financeApproval.action?'expenses':'invoices',action_code:globalThis.__financeApproval.action||'request'},matched_routes:[{id:4}]}:{instance_id:31,instance_no:'MARKED'}}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { submitFinanceApproval, createFinanceRequestFromAltoc, createFinanceApprovalInstance } = await import('../server/utils/enterpriseFinanceApproval.ts')
    for (const wrong of [null, 'altoc']) {
      globalThis.__financeApproval.prepareApp = wrong
      globalThis.__financeApproval.calls = []
      await assert.rejects(createFinanceApprovalInstance({}, { resource: 'invoices', bizId: 'IR1', actor: 'actor', title: 'Marked', key: 'original-key', requestNo: 'APF-FIN-stable', expectedVersion: 2, formData: {} }), { statusCode: 503 })
      assert.equal(globalThis.__financeApproval.calls.length, 1, 'no instance create for an incomplete or wrong tuple')
    }
    delete globalThis.__financeApproval.prepareApp
    globalThis.__financeApproval.calls = []
    assert.equal((await submitFinanceApproval({})).data.submitted, true)
    const calls = globalThis.__financeApproval.calls
    assert.equal(calls[0].op, 'finance.11b-invoice-approval-request')
    assert.equal(calls[0].body.authorization.action, 'edit')
    assert.equal(calls[2].opts.key, 'APF-FIN-stable')
    assert.equal(calls[2].opts.body.callback_url, '/api/v1/finance/workflow/callback')
    assert.equal(calls[2].uid, 'actor')
    assert.equal(calls[3].body.finance.payload.expectedVersion, 2)
    assert.equal(calls[3].opts.idempotencyKey, 'original-key')
    globalThis.__financeApproval.failed = true
    await assert.rejects(submitFinanceApproval({}), e => e.statusCode === 503 && e.data.requestFrozen === true)
    globalThis.__financeApproval.failed = false
    assert.equal((await submitFinanceApproval({})).data.submitted, true)
    assert.ok(globalThis.__financeApproval.calls.filter(c => c.op?.endsWith('-request')).every(c => c.opts.idempotencyKey === 'original-key'))
    globalThis.__financeApproval.denied = true
    globalThis.__financeApproval.calls = []
    await assert.rejects(submitFinanceApproval({}), { statusCode: 403 })
    assert.equal(globalThis.__financeApproval.calls.length, 0)
    globalThis.__financeApproval.denied = false
    for (const expectedVersion of [0, -1, '2', 1.5]) {
      globalThis.__financeApproval.body = { expectedVersion }
      await assert.rejects(submitFinanceApproval({}), { statusCode: 400 })
    }
    globalThis.__financeApproval.body = { expectedVersion: 2, scheduleVersion: 1, requestedAmount: '10.00', invoiceItem: 'Marked' }
    assert.equal((await createFinanceRequestFromAltoc({})).data.code, 'IR-SOURCE')
    const source = globalThis.__financeApproval.calls.at(-1)
    assert.equal(source.op, 'finance.11b-invoice-requests-from-altoc')
    assert.equal(source.body.authorization.resource, 'invoices')
    assert.deepEqual(JSON.parse(source.body.finance.payload.altocAuthorization), { resource: 'contract', action: 'edit', actorUid: 'actor', objectId: '1' })
    for (const [operation, action, code] of [['claims-submit', 'claim', 'CLM1'], ['project-requests-submit', 'project_expense', 'PER1'], ['payment-requests-submit', 'payment', 'PAY1']]) {
      globalThis.__financeApproval.action = action
      globalThis.__financeApproval.params.code = code
      globalThis.__financeApproval.body = { expectedVersion: 2 }
      globalThis.__financeApproval.calls = []
      assert.equal((await submitFinanceApproval({}, operation)).data.submitted, true)
      const expenseCalls = globalThis.__financeApproval.calls
      assert.equal(expenseCalls[0].op, 'finance.' + (action === 'payment' ? '13b-' : '13a-') + operation)
      assert.equal(expenseCalls[0].body.authorization.resource, 'expenses')
      assert.equal(expenseCalls[1].opts.body.resource_code, 'expenses')
      assert.equal(expenseCalls[1].opts.body.action_code, action)
      assert.equal(expenseCalls[3].op, expenseCalls[0].op)
      assert.equal(expenseCalls[3].body.finance.payload.phase, 'bind')
      assert.equal(expenseCalls[3].opts.idempotencyKey, 'original-key')
      // After refresh the browser only knows the pending row version.
      globalThis.__financeApproval.body = { expectedVersion: 3, recover: true }
      globalThis.__financeApproval.calls = []
      assert.equal((await submitFinanceApproval({}, operation)).data.submitted, true)
      const recovered = globalThis.__financeApproval.calls
      assert.deepEqual(recovered[0].body.finance.payload, { expectedVersion: 3, phase: 'recover' })
      assert.equal(recovered[2].opts.key, 'APF-FIN-stable')
      assert.equal(recovered[3].opts.idempotencyKey, 'original-key')
      assert.equal(recovered[3].body.finance.payload.expectedVersion, 2)
      globalThis.__financeApproval.body = { expectedVersion: 2 }
      globalThis.__financeApproval.failed = true
      await assert.rejects(submitFinanceApproval({}, operation), e => e.statusCode === 503 && e.data.requestFrozen === true)
      globalThis.__financeApproval.failed = false
      assert.equal((await submitFinanceApproval({}, operation)).data.submitted, true)
    }
    delete globalThis.__financeApproval.action
    globalThis.__financeApproval.body.altocAuthorization = '{}'
    await assert.rejects(createFinanceRequestFromAltoc({}), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__financeApproval
  }
})

test('Finance owning callback authenticates before exact tuple dispatch; UI submit has no approve fact', () => {
  const receiver = readFileSync(new URL('../server/routes/enterprise/api/v1/service/workflow/callback.post.ts', import.meta.url), 'utf8')
  assert.ok(receiver.indexOf('await requireEnterpriseAimsServiceIngress') < receiver.indexOf('body?.app_code === \'finance\''))
  assert.match(receiver, /resource_code === 'invoices'/)
  assert.match(receiver, /action_code === 'request'/)
  assert.match(receiver, /finance.approval-callback/)
  const source = readFileSync(new URL('../../finance/app/components/host/FinanceLedgerDetail.vue', import.meta.url), 'utf8')
  assert.match(source, /提交审批/)
  assert.match(source, /intent.key/)
  assert.doesNotMatch(source, /approved: true|status: 'approved'/)
  const dedicated = readFileSync(new URL('../../data-runtime/internal/apps/workflow/finance_invoice_receipt.go', import.meta.url), 'utf8')
  assert.match(dedicated, /SourceApp != "finance"/)
})
